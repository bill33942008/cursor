const fs = require("fs");
const path = require("path");

const schemaPath = path.join(__dirname, "..", "sql", "schema-postgres.sql");

let pgClient = null;
let initPromise = null;

function assertReady() {
  if (!pgClient) {
    throw new Error("postgres database is not initialized");
  }
}

function loadPgNativeClient() {
  try {
    const Client = require("pg-native");
    return Client;
  } catch (_err) {
    throw new Error(
      "DB_CLIENT=postgres requires optional dependency pg-native. On CentOS install postgresql-devel, gcc-c++, make, python3, then run npm install."
    );
  }
}

function quoteConnValue(value) {
  const text = String(value || "");
  if (!text) return "''";
  if (/[\s'\\]/.test(text)) {
    return `'${text.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  }
  return text;
}

function buildConnectionString() {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  const host = process.env.PGHOST || "127.0.0.1";
  const port = process.env.PGPORT || "5432";
  const user = process.env.PGUSER || "";
  const password = process.env.PGPASSWORD || "";
  const database = process.env.PGDATABASE || "";
  const sslmode = process.env.PGSSLMODE || "";

  if (!user || !database) {
    throw new Error("postgres config missing: set DATABASE_URL or PGUSER + PGDATABASE (+ PGPASSWORD)");
  }

  const parts = [
    `host=${quoteConnValue(host)}`,
    `port=${quoteConnValue(port)}`,
    `user=${quoteConnValue(user)}`,
    `dbname=${quoteConnValue(database)}`,
  ];
  if (password) {
    parts.push(`password=${quoteConnValue(password)}`);
  }
  if (sslmode) {
    parts.push(`sslmode=${quoteConnValue(sslmode)}`);
  }
  return parts.join(" ");
}

function normalizeParams(params) {
  if (!params || params.length === 0) {
    return [];
  }
  if (params.length === 1 && Array.isArray(params[0])) {
    return params[0];
  }
  return params;
}

function normalizeWriteParam(value) {
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
}

function normalizeRowValue(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
}

function normalizeRow(row) {
  if (!row || typeof row !== "object") {
    return row;
  }
  const output = {};
  Object.keys(row).forEach((key) => {
    output[key] = normalizeRowValue(row[key]);
  });
  return output;
}

function splitSqlStatements(sql) {
  const statements = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    const next = sql[i + 1];

    if (char === "'" && !inDouble) {
      current += char;
      if (inSingle && next === "'") {
        current += next;
        i += 1;
      } else {
        inSingle = !inSingle;
      }
      continue;
    }
    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
      current += char;
      continue;
    }
    if (char === ";" && !inSingle && !inDouble) {
      const trimmed = current.trim();
      if (trimmed) {
        statements.push(trimmed);
      }
      current = "";
      continue;
    }
    current += char;
  }

  const tail = current.trim();
  if (tail) {
    statements.push(tail);
  }
  return statements;
}

function quoteCamelAliases(sql) {
  return sql.replace(/\bAS\s+([A-Za-z_][A-Za-z0-9_]*)/gi, (match, alias) => {
    if (/[A-Z]/.test(alias)) {
      return `AS "${alias}"`;
    }
    return match;
  });
}

function transformDateFunctions(sql) {
  let output = sql;

  output = output.replace(
    /CAST\(strftime\('%Y'\s*,\s*'now'\)\s+AS\s+INTEGER\)/gi,
    "CAST(EXTRACT(YEAR FROM CURRENT_DATE) AS INTEGER)"
  );
  output = output.replace(/strftime\('%Y-%m'\s*,\s*'now'\)/gi, "TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM')");
  output = output.replace(/strftime\('%Y-%m'\s*,\s*([^)]+)\)/gi, "TO_CHAR($1, 'YYYY-MM')");
  output = output.replace(/strftime\('%Y'\s*,\s*'now'\)/gi, "CAST(EXTRACT(YEAR FROM CURRENT_DATE) AS INTEGER)");

  output = output.replace(/datetime\('now'\s*,\s*([^)]+)\)/gi, "(CURRENT_TIMESTAMP + ($1)::interval)");
  output = output.replace(/date\('now'\s*,\s*([^)]+)\)/gi, "(CURRENT_DATE + ($1)::interval)");
  output = output.replace(/datetime\('now'\)/gi, "CURRENT_TIMESTAMP");
  output = output.replace(/date\('now'\)/gi, "CURRENT_DATE");

  // sqlite helper datetime(column) is equivalent to plain column for timestamptz fields.
  output = output.replace(/datetime\(\s*([A-Za-z0-9_." ]+)\s*\)/gi, "($1)");

  return output;
}

function transformInsertOrIgnore(sql) {
  if (!/^\s*INSERT\s+OR\s+IGNORE\s+INTO/i.test(sql)) {
    return sql;
  }
  const withoutIgnore = sql.replace(/^\s*INSERT\s+OR\s+IGNORE\s+INTO/i, "INSERT INTO");
  if (/\bON\s+CONFLICT\b/i.test(withoutIgnore)) {
    return withoutIgnore;
  }
  return `${withoutIgnore.replace(/;\s*$/, "")} ON CONFLICT DO NOTHING`;
}

function appendReturningForChanges(sql) {
  if (!/^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql)) {
    return sql;
  }
  if (/\bRETURNING\b/i.test(sql)) {
    return sql;
  }
  return `${sql.replace(/;\s*$/, "")} RETURNING 1 AS "__changed__"`;
}

function convertQuestionMarkPlaceholders(sql) {
  let output = "";
  let index = 0;
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    const next = sql[i + 1];

    if (char === "'" && !inDouble) {
      output += char;
      if (inSingle && next === "'") {
        output += next;
        i += 1;
      } else {
        inSingle = !inSingle;
      }
      continue;
    }
    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
      output += char;
      continue;
    }
    if (char === "?" && !inSingle && !inDouble) {
      index += 1;
      output += `$${index}`;
      continue;
    }
    output += char;
  }

  return output;
}

function transformSql(sql, { forWrite = false } = {}) {
  let output = String(sql || "").trim();
  output = quoteCamelAliases(output);
  output = transformDateFunctions(output);
  output = transformInsertOrIgnore(output);
  if (forWrite) {
    output = appendReturningForChanges(output);
  }
  output = convertQuestionMarkPlaceholders(output);
  return output;
}

function executeQuery(sql, params = [], options = {}) {
  assertReady();
  const transformedSql = transformSql(sql, options);
  const normalizedParams = params.map(normalizeWriteParam);
  const rows = pgClient.querySync(transformedSql, normalizedParams);
  return Array.isArray(rows) ? rows.map(normalizeRow) : [];
}

class StatementWrapper {
  constructor(sql) {
    this.sql = sql;
  }

  get(...params) {
    const rows = executeQuery(this.sql, normalizeParams(params));
    return rows[0];
  }

  all(...params) {
    return executeQuery(this.sql, normalizeParams(params));
  }

  run(...params) {
    const rows = executeQuery(this.sql, normalizeParams(params), { forWrite: true });
    return { changes: Array.isArray(rows) ? rows.length : 0 };
  }
}

const db = {
  pragma(_sql) {
    // no-op for postgres backend
  },
  exec(sql) {
    assertReady();
    const statements = splitSqlStatements(String(sql || ""));
    statements.forEach((statement) => {
      executeQuery(statement, []);
    });
  },
  prepare(sql) {
    return new StatementWrapper(sql);
  },
};

async function initializeDatabase() {
  if (pgClient) {
    return;
  }
  if (initPromise) {
    await initPromise;
    return;
  }

  initPromise = (async () => {
    const PgNativeClient = loadPgNativeClient();
    const connectionString = buildConnectionString();
    const client = new PgNativeClient();
    client.connectSync(connectionString);
    pgClient = client;
  })();

  await initPromise;
}

function addColumnIfMissing(tableName, columnName, definitionSql) {
  const exists = db
    .prepare(
      `
      SELECT 1 AS c
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ?
        AND column_name = ?
      LIMIT 1
      `
    )
    .get(tableName, columnName);
  if (!exists) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${definitionSql};`);
  }
}

function initSchema() {
  const schemaSql = fs.readFileSync(schemaPath, "utf8");
  db.exec(schemaSql);

  addColumnIfMissing("users", "last_active_at", "last_active_at TIMESTAMPTZ");
  addColumnIfMissing("users", "timeline_is_public", "timeline_is_public INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing("users", "current_group_id", "current_group_id TEXT");
  addColumnIfMissing("users", "membership_tier", "membership_tier TEXT NOT NULL DEFAULT 'normal'");
  addColumnIfMissing("users", "vip_expires_at", "vip_expires_at TIMESTAMPTZ");
  addColumnIfMissing(
    "users",
    "profile_change_limit_per_year",
    "profile_change_limit_per_year INTEGER NOT NULL DEFAULT 2"
  );
  addColumnIfMissing(
    "users",
    "profile_change_used_this_year",
    "profile_change_used_this_year INTEGER NOT NULL DEFAULT 0"
  );
  addColumnIfMissing(
    "users",
    "profile_change_cycle_year",
    "profile_change_cycle_year INTEGER NOT NULL DEFAULT 1970"
  );
  addColumnIfMissing("users", "daily_post_limit_override", "daily_post_limit_override INTEGER");
  addColumnIfMissing(
    "users",
    "daily_group_create_limit_override",
    "daily_group_create_limit_override INTEGER"
  );
  addColumnIfMissing(
    "users",
    "scene_window_max_minutes_override",
    "scene_window_max_minutes_override INTEGER"
  );
  addColumnIfMissing("post_comments", "parent_comment_id", "parent_comment_id TEXT");
  addColumnIfMissing("post_comments", "reply_to_user_id", "reply_to_user_id TEXT");
  addColumnIfMissing("user_timeline_events", "media_json", "media_json TEXT NOT NULL DEFAULT '[]'");

  db.exec(
    "UPDATE users SET profile_change_cycle_year = CAST(EXTRACT(YEAR FROM CURRENT_DATE) AS INTEGER) WHERE profile_change_cycle_year IS NULL OR profile_change_cycle_year < 1970"
  );
}

function checkConnection() {
  db.prepare("SELECT 1 AS ok").get();
}

module.exports = {
  db,
  initializeDatabase,
  initSchema,
  checkConnection,
};
