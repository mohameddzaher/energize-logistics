/** A manager's name as HR holds it: the employee file's Arabic name, else the account name. */
async function managerNameOf(userId) {
  if (!userId) return '';
  const Employee = require('../models/Employee');
  const User = require('../models/User');
  const user = await User.findById(userId).select('firstName lastName linkedEmployee').lean();
  const emp = await Employee.findOne({ $or: [{ user: userId }, ...(user?.linkedEmployee ? [{ _id: user.linkedEmployee }] : [])] })
    .select('arabicName firstName lastName').lean();
  const ofFile = emp && (String(emp.arabicName || '').trim() || `${emp.firstName || ''} ${emp.lastName || ''}`.trim());
  return ofFile || (user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : '');
}

module.exports = { managerNameOf };
