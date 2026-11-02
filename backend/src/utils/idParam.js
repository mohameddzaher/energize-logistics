/**
 * Guard for ids in URLs.
 * A cut, bookmarked or hand-typed link can carry a non-id. Mongoose throws `CastError` before reaching the database, which the generic `catch` turns into a 500, so it looks like a server fault when there is simply no such record. The id is checked before the controller and 'not found' is returned.
 * 404 is the default. Where the file already has an explicit guard returning 400, pass `{ status: 400 }` so one route does not give two answers for the same error.
 * `router.param('id', ...)` applies to every route in that router with `:id`, so mount it only where `:id` is a Mongoose id in all of them. Plates, invoice numbers and codes use other param names and are not guarded here.
 */
const mongoose = require('mongoose');

const reject = (res, opts) => res
  .status(opts.status || 404)
  .json({ message: opts.message || (opts.status === 400 ? 'معرّف غير صالح' : 'غير موجود') });

/** For `router.param(name, ...)`: stops the request if the id is not a Mongoose id. */
const objectIdParam = (opts = {}) => (req, res, next, value) => (
  mongoose.isValidObjectId(value) ? next() : reject(res, opts)
);

/** The same guard as route middleware, for routers with two different `:id` params. */
const objectIdGuard = (name = 'id', opts = {}) => (req, res, next) => (
  mongoose.isValidObjectId(req.params[name]) ? next() : reject(res, opts)
);

/** Some ids are numbers rather than Mongoose ids, for example the tracking unit. */
const numericParam = (opts = {}) => (req, res, next) => (
  Number.isFinite(Number(req.params[opts.name || 'id'])) ? next() : reject(res, opts)
);

module.exports = { objectIdParam, objectIdGuard, numericParam };
