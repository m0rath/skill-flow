/*
  The built-in "Order & Checkout API" sample project, used by ?demo=order-checkout
  and the "Example project" button. Extracted verbatim from the legacy app.
*/

export const EXAMPLE_PROJECT = [
  {
    path: "package.json",
    text: '{\n  "name": "order-checkout-api",\n  "version": "1.0.0",\n  "description": "Order and checkout API with pricing calculation, payment authorization, and database persistence",\n  "main": "src/server.js",\n  "scripts": {\n    "start": "node src/server.js",\n    "dev": "nodemon src/server.js",\n    "test": "jest tests/checkout.test.js"\n  },\n  "dependencies": {\n    "express": "^4.19.2",\n    "pg": "^8.11.5",\n    "zod": "^3.23.8"\n  },\n  "devDependencies": {\n    "jest": "^29.7.0"\n  }\n}',
  },
  {
    path: "README.md",
    text: "# Order & Checkout API\n\nOrder & Checkout API is a Node.js microservice that manages customer checkout workflows. It validates order payloads, calculates pricing and sales tax, authorizes credit card charges via Stripe, persists confirmed orders in PostgreSQL, and sends customer receipt emails.\n\n## Getting Started\n\n1. Install dependencies: `npm install`\n2. Start the service: `npm start`\n3. Run tests: `npm test`\n\n## Architecture & Call Flow\n\n- **Router** (`src/routes/orders.js`): Exposes `POST /orders` and validates inputs with Zod.\n- **Order Service** (`src/services/order.js`): Coordinates linear checkout execution.\n- **Pricing Service** (`src/services/pricing.js`): Calculates subtotal, volume discounts, and taxes.\n- **Payment Service** (`src/services/payment.js`): Authorizes transaction with Stripe gateway.\n- **Database** (`src/db/orders.js`): Persists confirmed orders to PostgreSQL.\n- **Receipt Service** (`src/services/receipt.js`): Sends customer confirmation receipts.\n",
  },
  {
    path: "src/server.js",
    text: 'const express = require("express");\nconst orders = require("./routes/orders");\n\nconst app = express();\napp.use(express.json());\napp.use("/orders", orders);\n\napp.get("/health", (req, res) => {\n  res.json({ status: "healthy", timestamp: new Date().toISOString() });\n});\n\nconst PORT = process.env.PORT || 3000;\napp.listen(PORT, () => {\n  console.log(`Order Checkout API running on port ${PORT}`);\n});\n\nmodule.exports = app;\n',
  },
  {
    path: "src/routes/orders.js",
    text: 'const express = require("express");\nconst { z } = require("zod");\nconst { createOrder } = require("../services/order");\n\nconst router = express.Router();\n\nconst CreateOrderSchema = z.object({\n  customerId: z.string().min(1),\n  items: z.array(z.object({\n    sku: z.string(),\n    quantity: z.number().int().positive(),\n    unitPrice: z.number().positive(),\n  })).min(1),\n  paymentToken: z.string().min(1),\n});\n\nrouter.post("/", async (req, res) => {\n  const parsed = CreateOrderSchema.safeParse(req.body);\n  if (!parsed.success) {\n    return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });\n  }\n  const order = await createOrder(parsed.data);\n  res.status(201).json(order);\n});\n\nmodule.exports = router;\n',
  },
  {
    path: "src/services/order.js",
    text: 'const { calculatePricing } = require("./pricing");\nconst { authorizeCharge } = require("./payment");\nconst { insertOrderRecord } = require("../db/orders");\nconst { sendReceipt } = require("./receipt");\n\nasync function createOrder(payload) {\n  // Step 1: calculate subtotal, discounts, and taxes\n  const pricing = calculatePricing(payload.items);\n\n  // Step 2: charge payment via gateway\n  const payment = await authorizeCharge({\n    token: payload.paymentToken,\n    amount: pricing.total,\n    currency: "USD",\n  });\n\n  // Step 3: store confirmed order in database\n  const order = await insertOrderRecord({\n    customerId: payload.customerId,\n    items: payload.items,\n    pricing,\n    paymentId: payment.chargeId,\n    status: "confirmed",\n  });\n\n  // Step 4: send receipt notification to customer\n  await sendReceipt(order);\n\n  return order;\n}\n\nmodule.exports = { createOrder };\n',
  },
  {
    path: "src/services/pricing.js",
    text: "function calculatePricing(items) {\n  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);\n  const discount = subtotal > 100 ? Math.round(subtotal * 0.1 * 100) / 100 : 0;\n  const taxable = subtotal - discount;\n  const tax = Math.round(taxable * 0.08 * 100) / 100;\n  const total = Math.round((taxable + tax) * 100) / 100;\n  return { subtotal, discount, tax, total };\n}\n\nmodule.exports = { calculatePricing };\n",
  },
  {
    path: "src/services/payment.js",
    text: 'async function authorizeCharge({ token, amount, currency }) {\n  const response = await fetch("https://api.stripe.com/v1/charges", {\n    method: "POST",\n    headers: { "Content-Type": "application/json" },\n    body: JSON.stringify({ token, amount, currency }),\n  });\n  return { chargeId: "ch_" + Date.now(), status: "succeeded" };\n}\n\nmodule.exports = { authorizeCharge };\n',
  },
  {
    path: "src/db/orders.js",
    text: 'const { Pool } = require("pg");\n\nconst pool = new Pool({ connectionString: process.env.DATABASE_URL });\n\nasync function insertOrderRecord(order) {\n  const query = "INSERT INTO orders (customer_id, items, pricing, payment_id, status) VALUES ($1, $2, $3, $4, $5) RETURNING *";\n  const { rows } = await pool.query(query, [\n    order.customerId,\n    JSON.stringify(order.items),\n    JSON.stringify(order.pricing),\n    order.paymentId,\n    order.status,\n  ]);\n  return rows[0] || { id: "ord_" + Date.now(), ...order };\n}\n\nmodule.exports = { insertOrderRecord };\n',
  },
  {
    path: "src/services/receipt.js",
    text: 'async function sendReceipt(order) {\n  await fetch("https://api.sendgrid.com/v3/mail/send", {\n    method: "POST",\n    headers: { "Content-Type": "application/json" },\n    body: JSON.stringify({\n      to: order.customerId,\n      subject: `Order Confirmation #${order.id || "NEW"}`,\n      body: `Your payment was authorized. Total: $${order.pricing?.total || 0}`,\n    }),\n  });\n}\n\nmodule.exports = { sendReceipt };\n',
  },
  {
    path: "tests/checkout.test.js",
    text: 'const { calculatePricing } = require("../src/services/pricing");\n\ntest("calculates subtotal and 8% tax correctly", () => {\n  const items = [{ sku: "ITEM-A", quantity: 2, unitPrice: 20 }];\n  const pricing = calculatePricing(items);\n  expect(pricing.subtotal).toBe(40);\n  expect(pricing.tax).toBe(3.2);\n  expect(pricing.total).toBe(43.2);\n});\n',
  },
];
export const EXAMPLE_PROJECT_MODEL = {
  title: "Order & Checkout API",
  summary:
    "A robust Node.js checkout service that validates shopping carts, calculates tiered pricing and taxes, authorizes payments via Stripe, saves confirmed orders in PostgreSQL, and sends customer receipts.",
  trigger: "E-commerce frontends and mobile clients submit POST /orders requests during checkout.",
  stack: ["Node.js 20", "Express", "Zod", "PostgreSQL (pg)", "Stripe API", "SendGrid", "Jest"],
  inputs: [
    "Node.js 20 runtime",
    "PostgreSQL database (DATABASE_URL)",
    "Stripe API Secret Key",
    "SendGrid Mail API Key",
  ],
  notes: [
    "Strict layered separation: routes handle HTTP validation, services orchestrate business logic, db manages data.",
    "Idempotent payment authorization ensures customers are never double-charged.",
    "Zod schemas enforce strict payload typing before service execution.",
    "Asynchronous receipt dispatch prevents blocking the checkout HTTP response.",
  ],
  commands: [
    { cmd: "npm install", purpose: "Install service dependencies" },
    { cmd: "npm start", purpose: "Start the checkout API server on port 3000" },
    { cmd: "npm test", purpose: "Run unit and pricing calculation tests" },
  ],
  components: [
    {
      name: "API Server",
      path: "src/server.js",
      kind: "api",
      purpose: "Configures Express, mounts routes, and manages application startup.",
      depends: ["Order Routes"],
    },
    {
      name: "Order Routes",
      path: "src/routes/orders.js",
      kind: "api",
      purpose: "Validates incoming HTTP order payloads and sends responses.",
      depends: ["Order Service"],
    },
    {
      name: "Order Service",
      path: "src/services/order.js",
      kind: "service",
      purpose: "Orchestrates order creation, pricing, payments, and database storage.",
      depends: ["Pricing Service", "Payment Service", "Order Storage", "Receipt Service"],
    },
    {
      name: "Pricing Service",
      path: "src/services/pricing.js",
      kind: "service",
      purpose: "Calculates line item subtotals, volume discounts, and sales tax.",
      depends: [],
    },
    {
      name: "Payment Service",
      path: "src/services/payment.js",
      kind: "service",
      purpose: "Authorizes card charges with external payment gateway.",
      depends: [],
    },
    {
      name: "Order Storage",
      path: "src/db/orders.js",
      kind: "data",
      purpose: "Stores confirmed orders and transaction IDs in PostgreSQL.",
      depends: [],
    },
    {
      name: "Receipt Service",
      path: "src/services/receipt.js",
      kind: "service",
      purpose: "Dispatches customer confirmation emails and webhook alerts.",
      depends: [],
    },
    {
      name: "Test Suite",
      path: "tests",
      kind: "tests",
      purpose: "Unit tests verifying tax formulas, tiered discounts, and validation schemas.",
      depends: ["Pricing Service"],
    },
  ],
  steps: [
    {
      kind: "step",
      title: "Initialize API server",
      detail: "src/server.js starts Express on PORT 3000 and registers the /orders route handler.",
      uses: ["src/server.js", "src/routes/orders.js"],
      source: "app.listen(PORT, ...)",
    },
    {
      kind: "loop",
      title: "Process checkout request",
      over: "every incoming POST /orders call",
      steps: [
        {
          kind: "decision",
          title: "Validate order payload",
          question: "Does the payload match CreateOrderSchema?",
          detail: "Zod verifies customer ID, positive quantities, and valid payment tokens.",
          uses: ["src/routes/orders.js"],
          source: "CreateOrderSchema.safeParse(req.body)",
          branches: [
            {
              label: "Valid",
              steps: [
                {
                  kind: "step",
                  title: "Calculate pricing & tax",
                  detail:
                    "Computes subtotal from line items, applies volume discounts if over $100, and calculates 8% sales tax.",
                  uses: ["src/services/pricing.js"],
                  source: "calculatePricing(payload.items)",
                },
                {
                  kind: "step",
                  title: "Authorize payment charge",
                  detail: "Communicates with payment gateway API to authorize the order total.",
                  uses: ["src/services/payment.js"],
                  creates: [{ name: "Payment authorization token", kind: "data" }],
                  source: "await authorizeCharge(...)",
                },
                {
                  kind: "step",
                  title: "Store confirmed order in DB",
                  detail: "Inserts the order row into PostgreSQL with status 'confirmed' and payment reference.",
                  uses: ["src/db/orders.js"],
                  creates: [{ name: "PostgreSQL orders record", kind: "file" }],
                  source: "await insertOrderRecord(...)",
                },
                {
                  kind: "step",
                  title: "Dispatch customer receipt",
                  detail: "Sends confirmation email and invoice receipt asynchronously via SendGrid API.",
                  uses: ["src/services/receipt.js"],
                  creates: [{ name: "Customer receipt email", kind: "message" }],
                  source: "await sendReceipt(order)",
                },
                {
                  kind: "step",
                  title: "Return HTTP 201 Created",
                  detail: "Sends HTTP 201 response with complete order confirmation JSON to client.",
                  uses: ["src/routes/orders.js"],
                  creates: [{ name: "HTTP 201 response", kind: "message" }],
                  source: "res.status(201).json(order)",
                },
              ],
            },
            {
              label: "Invalid",
              steps: [
                {
                  kind: "stop",
                  title: "Return HTTP 400 Bad Request",
                  detail: "Rejects request and returns schema validation error details to client.",
                  uses: ["src/routes/orders.js"],
                  creates: [{ name: "HTTP 400 error response", kind: "message" }],
                  source: "res.status(400).json({ error: 'Validation failed' })",
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};
