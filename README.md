# Ballers Backend API

> Node.js/Express REST API for the Ballers World Cup Soccer T-Shirts E-Commerce Platform

## Overview

Ballers Backend provides a secure, scalable REST API for the Ballers e-commerce platform — an online store specializing in customizable World Cup soccer team T-shirts.

## Tech Stack

| Technology | Version | Purpose |
|---|---|---|
| Node.js | 20+ | Runtime |
| Express | 4.x | Web framework |
| MongoDB | Atlas | Database |
| Mongoose | 8.x | ODM |
| JWT | 9.x | Authentication |
| bcryptjs | 2.x | Password hashing |
| Joi | 17.x | Input validation |
| Multer | 1.x | File uploads |
| Winston | 3.x | Logging |
| Helmet | 7.x | Security headers |
| express-rate-limit | 7.x | Rate limiting |

## Project Structure

```
ballers-backend/
├── src/
│   ├── index.js              # Entry point: bootstrap server
│   ├── app.js                # Express app factory (middleware + routes)
│   ├── middleware/
│   │   ├── auth.js           # JWT authentication/authorization
│   │   ├── error.js          # Centralized error handling
│   │   └── validation.js     # Joi request validation
│   ├── models/               # Mongoose schemas (Task 2)
│   │   ├── User.js
│   │   ├── Team.js
│   │   ├── Product.js
│   │   ├── Cart.js
│   │   └── Order.js
│   ├── controllers/          # Route handlers (Tasks 3-6)
│   │   ├── authCtrl.js
│   │   ├── productCtrl.js
│   │   ├── cartCtrl.js
│   │   └── orderCtrl.js
│   ├── services/
│   │   ├── db.js             # MongoDB connection manager
│   │   └── upload.js         # Multer file upload service
│   ├── routes/
│   │   └── api/
│   │       ├── auth.js
│   │       ├── teams.js
│   │       ├── products.js
│   │       ├── cart.js
│   │       └── orders.js
│   └── utils/
│       ├── logger.js         # Winston logger
│       ├── constants.js      # App-wide constants
│       └── validateEnv.js    # Env var validation
├── uploads/                  # Product image storage
├── logs/                     # Application logs (production)
├── .env.example              # Environment variable template
├── .gitignore
└── package.json
```

## Getting Started

### Prerequisites

- Node.js 20+
- MongoDB (local or Atlas)

### Installation

```bash
# Clone the repository
git clone https://github.com/liorboyango/ballers-backend.git
cd ballers-backend

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your MongoDB URI and JWT secret
```

### Running the Server

```bash
# Development (with auto-reload)
npm run dev

# Production
npm start
```

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `MONGO_URI` | ✅ | MongoDB connection string |
| `JWT_SECRET` | ✅ | JWT signing secret (min 32 chars) |
| `PORT` | ❌ | Server port (default: 5000) |
| `NODE_ENV` | ❌ | Environment (default: development) |
| `FRONTEND_URL` | ❌ | Frontend URL for CORS (default: http://localhost:3000) |
| `LOG_LEVEL` | ❌ | Log verbosity (default: debug) |

## API Endpoints

### Public

| Method | Endpoint | Description |
|---|---|---|
| GET | `/health` | Server health check |
| GET | `/api/teams` | List all World Cup teams |
| GET | `/api/products` | List products (filter: `?teamId=`) |
| GET | `/api/products/:id` | Get product details |
| POST | `/api/auth/register` | Register new user |
| POST | `/api/auth/login` | Login and get JWT |

### Protected (JWT Required)

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/auth/me` | Get current user profile |
| GET | `/api/cart` | Get user's cart |
| POST | `/api/cart/add` | Add item to cart |
| PUT | `/api/cart/update` | Update cart item |
| DELETE | `/api/cart/item/:itemId` | Remove cart item |
| POST | `/api/orders` | Create order |
| GET | `/api/orders` | Get user's orders |
| GET | `/api/orders/:id` | Get order details |

## Security

- **Helmet**: Sets security HTTP headers
- **CORS**: Whitelist-based origin control
- **Rate Limiting**: 100 req/min globally, 10 req/min for auth
- **JWT**: Stateless authentication with 24h expiry
- **bcrypt**: Password hashing with 12 salt rounds
- **Joi**: Server-side input validation on all endpoints
- **Multer**: File type and size validation for uploads

## Deployment

Deployed on Render. Required environment variables:
- `NODE_ENV=production`
- `MONGO_URI` (MongoDB Atlas connection string)
- `JWT_SECRET` (strong random secret)
- `FRONTEND_URL` (deployed frontend URL)

## License

MIT
