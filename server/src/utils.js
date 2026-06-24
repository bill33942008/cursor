function parsePagination(query) {
  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 50);
  const offset = Math.max(Number(query.offset) || 0, 0);
  return { limit, offset };
}

module.exports = {
  parsePagination,
};
