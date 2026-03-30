const { validationResult } = require('express-validator');

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const errorList = errors.array().map((err) => ({
      field: err.path,
      message: err.msg,
    }));
    // Build a human-readable message with specific field details
    const details = errorList
      .map((e) => {
        const fieldName = e.field.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());
        const msg = e.message === 'Invalid value' ? `${fieldName} is invalid` : e.message;
        return msg;
      })
      .join('. ');
    return res.status(400).json({
      message: details || 'Validation failed',
      errors: errorList,
    });
  }
  next();
};

module.exports = validate;
