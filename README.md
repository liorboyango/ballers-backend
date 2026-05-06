# Ballers Backend

Node.js/Express REST API for the Ballers World Cup soccer kit e-commerce platform.

## Tech Stack

- **Runtime**: Node.js 20+
- **Framework**: Express 4
- **Database**: MongoDB with Mongoose 8
- **Auth**: JWT (jsonwebtoken) + bcryptjs
- **Validation**: Joi
- **File Uploads**: Multer
- **Security**: helmet, cors, express-rate-limit
- **Logging**: morgan + custom logger

## Getting Started

### Prerequisites

- Node.js 20+
- MongoDB Atlas account (or local MongoDB)

### Installation

```bash
npm install
```

### Environment Variables

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

Required variables:
- `MONGO_URI` — MongoDB connection string
- `JWT_SECRET` — Secret key for JWT signing (use a long random string)

Optional:
- `PORT` — Server port (default: 5000)
- `NODE_ENV` — `development` or `production`
- `FRONTEND_URL` — Frontend origin for CORS (default: http://localhost:3000)
- `JWT_EXPIRES_IN` — JWT expiry (default: 24h)
- `MAX_FILE_SIZE` — Max upload size in bytes (default: 5242880 = 5MB)

### Running

```bash
# Development (with auto-reload)
npm run dev

# Production
npm start
```

## API Endpoints

### Public

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/api/teams` | List all teams |
| GET | `/api/teams/:id` | Get team by ID |
| GET | `/api/products` | List products (filter: `?teamId`, `?kitType`, `?size`, `?featured`, `?page`, `?limit`) |
| GET | `/api/products/:id` | Get product by ID |

### Auth

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` | Register new user |
| POST | `/api/auth/login` | Login, returns JWT |
| GET | `/api/auth/me` | Get current user (protected) |

### Cart (Protected — Bearer JWT required)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/cart` | Get user's cart |
| POST | `/api/cart/add` | Add item to cart |
| PUT | `/api/cart/update` | Update item quantity |
| DELETE | `/api/cart/item` | Remove item from cart |
| DELETE | `/api/cart` | Clear cart |

### Orders (Protected — Bearer JWT required)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/orders/create` | Create order from cart |
| GET | `/api/orders` | Get order history |
| GET | `/api/orders/:id` | Get order by ID |

### Admin (Protected + Admin role)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/products` | Create product (with image upload) |
| PUT | `/api/products/:id` | Update product |
| DELETE | `/api/products/:id` | Delete product |

## Deployment (Render)

Set the following environment variables in Render:

- `NODE_ENV=production`
- `MONGO_URI=<your MongoDB Atlas URI>`
- `JWT_SECRET=<your secret>`
- `FRONTEND_URL=<your frontend URL>`

The start command is: `npm start`
