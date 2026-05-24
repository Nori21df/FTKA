function flashMiddleware(req, res, next) {
  req.flash = (category, message) => {
    req.session.flash = req.session.flash || [];
    req.session.flash.push([category, message]);
  };
  res.locals.get_flashed_messages = (options = {}) => {
    const withCategories = Boolean(options.with_categories || options.withCategories);
    const messages = req.session.flash || [];
    req.session.flash = [];
    return withCategories ? messages : messages.map(([, message]) => message);
  };
  next();
}

module.exports = flashMiddleware;
