const ExpenseCategory = require("../models/ExpenseCategory");
const logAudit = require("../utils/auditLogger");
const { emitToAll } = require("../websocket/socketManager");

exports.createCategory = async (req, res) => {
  try {
    const { name, description } = req.body;
    const category = await ExpenseCategory.create({
      name,
      description,
      createdBy: req.user._id,
    });

    await logAudit({
      user: req.user._id,
      action: "create_expense_category",
      entity: "ExpenseCategory",
      entityId: category._id,
      changes: { after: { name } },
      ipAddress: req.ip,
    });
    try {
      emitToAll("expenseCategory:created", { category });
    } catch (e) {}

    res.status(201).json({ category });
  } catch (error) {
    if (error.code === 11000)
      return res.status(400).json({ message: "Category already exists" });
    res
      .status(500)
      .json({ message: error.message || "Failed to create category" });
  }
};

exports.getCategories = async (req, res) => {
  try {
    const filter = {};
    if (req.query.active === "true") filter.isActive = true;
    const categories = await ExpenseCategory.find(filter).sort({ name: 1 });
    res.json({ categories });
  } catch (error) {
    res.status(500).json({ message: "Failed to load categories" });
  }
};

exports.updateCategory = async (req, res) => {
  try {
    const { name, description, isActive } = req.body;
    const category = await ExpenseCategory.findByIdAndUpdate(
      req.params.id,
      { name, description, isActive },
      { new: true, runValidators: true },
    );
    if (!category)
      return res.status(404).json({ message: "Category not found" });

    await logAudit({
      user: req.user._id,
      action: "update_expense_category",
      entity: "ExpenseCategory",
      entityId: category._id,
      changes: { after: { name } },
      ipAddress: req.ip,
    });
    try {
      emitToAll("expenseCategory:updated", { category });
    } catch (e) {}

    res.json({ category });
  } catch (error) {
    if (error.code === 11000)
      return res.status(400).json({ message: "Category already exists" });
    res.status(500).json({ message: "Failed to update category" });
  }
};

exports.deleteCategory = async (req, res) => {
  try {
    const category = await ExpenseCategory.findByIdAndDelete(req.params.id);
    if (!category)
      return res.status(404).json({ message: "Category not found" });

    await logAudit({
      user: req.user._id,
      action: "delete_expense_category",
      entity: "ExpenseCategory",
      entityId: category._id,
      changes: { before: { name: category.name } },
      ipAddress: req.ip,
    });
    try {
      emitToAll("expenseCategory:deleted", { categoryId: category._id });
    } catch (e) {}

    res.json({ message: "Category deleted" });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete category" });
  }
};
