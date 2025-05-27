const Invoice = require('../models/Invoice');
const Vendor = require('../models/vendorModel');
const Product = require('../models/Product');
const asyncHandler = require('express-async-handler');
const { incrementVoucherId } = require('./voucherController');
const { addChemicalsToCentral } = require('./ChemicalController');

// Helper to generate unique invoiceId (e.g., INV-YYYYMMDD-XXXX)
async function generateInvoiceId() {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
  const count = await Invoice.countDocuments({
    createdAt: {
      $gte: new Date(today.getFullYear(), today.getMonth(), today.getDate()),
      $lt: new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
    }
  });
  return `INV-${dateStr}-${(count + 1).toString().padStart(3, '0')}`;
}

// @desc    Create a new invoice
// @route   POST /api/invoices
// @access  Private (role-safe)
const createInvoice = asyncHandler(async (req, res) => {
  const { vendorId, invoiceNumber, invoiceDate, lineItems, totalInvoicePrice  } = req.body;
  if (!vendorId || !invoiceNumber || !invoiceDate || !Array.isArray(lineItems) || lineItems.length === 0) {
    return res.status(400).json({ message: 'All fields are required' });
  }
  // Fetch vendor
  const vendor = await Vendor.findById(vendorId);
  if (!vendor) return res.status(404).json({ message: 'Vendor not found' });
  // Prevent duplicate products in lineItems
  const productIds = lineItems.map(item => item.productId.toString());
  if (new Set(productIds).size !== productIds.length) {
    return res.status(400).json({ message: 'Duplicate products in invoice' });
  }
  // Validate and enrich line items
  const enrichedItems = await Promise.all(lineItems.map(async item => {
    const product = await Product.findById(item.productId);
    if (!product) throw new Error('Product not found');
    if (product.category !== 'chemical') throw new Error('Only chemical products allowed');
    return {
      productId: product._id,
      name: product.name,
      unit: product.unit,
      thresholdValue: product.thresholdValue,
      quantity: item.quantity,
      totalPrice: item.totalPrice,
      pricePerUnit: item.totalPrice / item.quantity,
      expiryDate: item.expiryDate // Add expiryDate from request
    };
  }));
  // Generate invoiceId
  const invoiceId = await generateInvoiceId();
  // Save invoice
  const invoice = await Invoice.create({
    invoiceId,
    vendorId: vendor._id,
    vendorName: vendor.name,
    invoiceNumber,
    invoiceDate,
    totalInvoicePrice, // <-- Save total invoice price
    lineItems: enrichedItems
  });

  // Post-processing: Add chemicals to Chemical Master (only for chemical invoices)
  try {
    const chemicals = enrichedItems.map(item => ({
      chemicalName: item.name,
      quantity: item.quantity,
      unit: item.unit,
      expiryDate: item.expiryDate,
      vendor: vendor.name,
      pricePerUnit: item.pricePerUnit,
      department: 'chemical'
    }));
    if (chemicals.length > 0) {
      await addChemicalsToCentral({ body: { chemicals } }, { status: () => ({ json: () => {} }) });
    }
  } catch (err) {
    // Log but don't block invoice creation
    console.error('Failed to add chemicals to Chemical Master:', err.message);
  }

  // Increment voucherId for 'invoice' category after successful creation
  try {
    await incrementVoucherId({ body: { category: 'invoice' } }, { status: () => ({ json: () => {} }) });
  } catch (err) {
    // Log but don't block invoice creation
    console.error('Failed to increment voucherId:', err.message);
  }

  res.status(201).json(invoice);
});

// @desc    Create a new invoice for glassware
// @route   POST /api/invoices/glassware
// @access  Private (role-safe)
const createGlasswareInvoice = asyncHandler(async (req, res) => {
  const { vendorId, invoiceNumber, invoiceDate, lineItems } = req.body;
  if (!vendorId || !invoiceNumber || !invoiceDate || !Array.isArray(lineItems) || lineItems.length === 0) {
    return res.status(400).json({ message: 'All fields are required' });
  }
  // Fetch vendor
  const vendor = await Vendor.findById(vendorId);
  if (!vendor) return res.status(404).json({ message: 'Vendor not found' });
  // Prevent duplicate products in lineItems
  const productIds = lineItems.map(item => item.productId.toString());
  if (new Set(productIds).size !== productIds.length) {
    return res.status(400).json({ message: 'Duplicate products in invoice' });
  }
  // Validate and enrich line items
  const enrichedItems = await Promise.all(lineItems.map(async item => {
    const product = await Product.findById(item.productId);
    if (!product) throw new Error('Product not found');
    if (product.category !== 'glassware') throw new Error('Only glassware products allowed');
    return {
      productId: product._id,
      name: product.name,
      unit: product.unit,
      thresholdValue: product.thresholdValue,
      quantity: item.quantity,
      totalPrice: item.totalPrice,
      pricePerUnit: item.totalPrice / item.quantity,
      expiryDate: item.expiryDate // still required for consistency
    };
  }));
  // Generate invoiceId
  const invoiceId = await generateInvoiceId();
  // Save invoice
  const invoice = await Invoice.create({
    invoiceId,
    vendorId: vendor._id,
    vendorName: vendor.name,
    invoiceNumber,
    invoiceDate,
    lineItems: enrichedItems
  });
  try {
    await incrementVoucherId({ body: { category: 'invoice' } }, { status: () => ({ json: () => {} }) });
  } catch (err) {
    console.error('Failed to increment voucherId:', err.message);
  }
  res.status(201).json(invoice);
});

// @desc    Create a new invoice for other products
// @route   POST /api/invoices/others
// @access  Private (role-safe)
const createOthersInvoice = asyncHandler(async (req, res) => {
  const { vendorId, invoiceNumber, invoiceDate, lineItems } = req.body;
  if (!vendorId || !invoiceNumber || !invoiceDate || !Array.isArray(lineItems) || lineItems.length === 0) {
    return res.status(400).json({ message: 'All fields are required' });
  }
  // Fetch vendor
  const vendor = await Vendor.findById(vendorId);
  if (!vendor) return res.status(404).json({ message: 'Vendor not found' });
  // Prevent duplicate products in lineItems
  const productIds = lineItems.map(item => item.productId.toString());
  if (new Set(productIds).size !== productIds.length) {
    return res.status(400).json({ message: 'Duplicate products in invoice' });
  }
  // Validate and enrich line items
  const enrichedItems = await Promise.all(lineItems.map(async item => {
    const product = await Product.findById(item.productId);
    if (!product) throw new Error('Product not found');
    if (product.category !== 'others') throw new Error('Only other products allowed');
    return {
      productId: product._id,
      name: product.name,
      unit: product.unit,
      thresholdValue: product.thresholdValue,
      quantity: item.quantity,
      totalPrice: item.totalPrice,
      pricePerUnit: item.totalPrice / item.quantity,
      expiryDate: item.expiryDate // still required for consistency
    };
  }));
  // Generate invoiceId
  const invoiceId = await generateInvoiceId();
  // Save invoice
  const invoice = await Invoice.create({
    invoiceId,
    vendorId: vendor._id,
    vendorName: vendor.name,
    invoiceNumber,
    invoiceDate,
    lineItems: enrichedItems
  });
  try {
    await incrementVoucherId({ body: { category: 'invoice' } }, { status: () => ({ json: () => {} }) });
  } catch (err) {
    console.error('Failed to increment voucherId:', err.message);
  }
  res.status(201).json(invoice);
});

// @desc    Get all invoices
// @route   GET /api/invoices
// @access  Private (role-safe)
const getInvoices = asyncHandler(async (req, res) => {
  const invoices = await Invoice.find().populate('vendorId', 'name vendorCode').sort({ createdAt: -1 });
  res.status(200).json(invoices);
});

module.exports = { createInvoice, getInvoices, createGlasswareInvoice, createOthersInvoice };
