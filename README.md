# Fortune Tickets Backend

This is the backend server for the Fortune Tickets application.

## Environment Variables

Create a `.env` file in the root directory with the following variables:

```env
# MongoDB Connection
MONGODB_URI=your_mongodb_uri_here

# Moralis API Key
MORALIS_API_KEY=your_moralis_api_key_here

# Server Port
PORT=3001

# Contract Addresses
ERC721_CONTRACT_ADDRESS=0xE64Ea2215CD88a5d3cfe764bCEB2c1e3C60ECfC4
ERC404_CONTRACT_ADDRESS=0x99A8374c5cf5E45151102F367ada3B47F636951c
```

## Deployment to Vercel

1. Install Vercel CLI:
```bash
npm i -g vercel
```

2. Login to Vercel:
```bash
vercel login
```

3. Deploy to Vercel:
```bash
vercel
```

4. Set up environment variables in Vercel:
   - Go to your project settings in Vercel
   - Add the following environment variables:
     - `MONGODB_URI`
     - `MORALIS_API_KEY`
     - `ERC721_CONTRACT_ADDRESS`
     - `ERC404_CONTRACT_ADDRESS`

## Local Development

1. Install dependencies:
```bash
npm install
```

2. Start the development server:
```bash
npm run dev
```

The server will run on http://localhost:3001 