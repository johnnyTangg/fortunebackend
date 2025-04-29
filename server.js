require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const Moralis = require('@moralisweb3/evm-api');
const { ethers } = require('ethers');
const WebSocket = require('ws');

const app = express();

// Event ABIs for decoding
const eventABIs = {
  Transfer: [
    "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"
  ],
  TicketMinted: [
    "event TicketMinted(address indexed to, uint256 indexed tokenId, bool isETHVersion, tuple(uint256 rollNumber, uint256 winPercentage, uint256 winAmount)[] levels)"
  ],
  TicketOpeningInitiated: [
    "event TicketOpeningInitiated(uint256 indexed tokenId, address indexed opener)"
  ],
  TicketResolved: [
    "event TicketResolved(uint256 indexed tokenId, uint256 rollResult, uint256 winAmount)"
  ],
  RewardPaid: [
    "event RewardPaid(address indexed winner, uint256 indexed tokenId, uint256 amount)"
  ],
  PoolDeposited: [
    "event PoolDeposited(address indexed depositor, uint256 amount)"
  ],
  PoolWithdrawn: [
    "event PoolWithdrawn(address indexed withdrawer, uint256 amount)"
  ]
};

// Create interfaces for decoding
const interfaces = {
  Transfer: new ethers.utils.Interface(eventABIs.Transfer),
  TicketMinted: new ethers.utils.Interface(eventABIs.TicketMinted),
  TicketOpeningInitiated: new ethers.utils.Interface(eventABIs.TicketOpeningInitiated),
  TicketResolved: new ethers.utils.Interface(eventABIs.TicketResolved),
  RewardPaid: new ethers.utils.Interface(eventABIs.RewardPaid),
  PoolDeposited: new ethers.utils.Interface(eventABIs.PoolDeposited),
  PoolWithdrawn: new ethers.utils.Interface(eventABIs.PoolWithdrawn)
};

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  credentials: false
}));

// Add security headers middleware
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
  res.setHeader('Access-Control-Allow-Credentials', 'false');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Handle OPTIONS requests
app.options('*', cors());

app.use(express.json());

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Initialize Moralis
const moralis = new Moralis.EvmApi({
  apiKey: process.env.MORALIS_API_KEY,
});

// ERC404 Fungible Balance Schema
const erc404FungibleSchema = new mongoose.Schema({
  address: { type: String, required: true, unique: true },
  balance: { type: String, default: '0' }
});

// ERC404 NFT Holdings Schema
const erc404NFTSchema = new mongoose.Schema({
  tokenId: { type: String, required: true, unique: true },
  owner: { type: String, required: true }
});

// ERC721 Holdings Schema
const erc721HoldingsSchema = new mongoose.Schema({
  tokenId: { type: String, required: true, unique: true },
  owner: { type: String, required: true }
});

const ERC404Fungible = mongoose.model('ERC404Fungible', erc404FungibleSchema);
const ERC404NFT = mongoose.model('ERC404NFT', erc404NFTSchema);
const ERC721Holding = mongoose.model('ERC721Holding', erc721HoldingsSchema);

// Transaction Schema to track processed transactions
const transactionSchema = new mongoose.Schema({
  transactionHash: { type: String, required: true, unique: true },
  processedAt: { type: Date, default: Date.now }
});

const ProcessedTransaction = mongoose.model('ProcessedTransaction', transactionSchema);

// Opening Schema
const openingSchema = new mongoose.Schema({
  tokenId: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  transactionHash: { type: String, required: true },
  tokenType: { type: String, enum: ['ERC721', 'ERC404'], required: true },
  opener: { type: String, required: true }
});

// Minting Details Schema
const mintingDetailsSchema = new mongoose.Schema({
  tokenId: { type: String, required: true, unique: true },
  levels: [{
    winAmount: { type: String, required: true },
    rollNumber: { type: Number, required: true }
  }],
  rollResult: { type: Number },
  payout: { type: String },
  timestamp: { type: Date, default: Date.now },
  transactionHash: { type: String, required: true }
});

const Opening = mongoose.model('Opening', openingSchema);
const MintingDetails = mongoose.model('MintingDetails', mintingDetailsSchema);

// Stream Configuration
const streamConfig = {
  chains: ['eth'], // Add your chain IDs here
  description: 'Fortune Tickets Transfer Events Stream',
  tag: 'fortune-tickets-transfers',
  webhookUrl: process.env.WEBHOOK_URL || 'http://localhost:3001/webhook', // Use environment variable with fallback
  abi: [
    // ERC721 Transfer event
    {
      anonymous: false,
      inputs: [
        {
          indexed: true,
          name: 'from',
          type: 'address'
        },
        {
          indexed: true,
          name: 'to',
          type: 'address'
        },
        {
          indexed: true,
          name: 'tokenId',
          type: 'uint256'
        }
      ],
      name: 'Transfer',
      type: 'event'
    },
    // ERC404 Transfer event
    {
      anonymous: false,
      inputs: [
        {
          indexed: true,
          name: 'from',
          type: 'address'
        },
        {
          indexed: true,
          name: 'to',
          type: 'address'
        },
        {
          indexed: false,
          name: 'amount',
          type: 'uint256'
        }
      ],
      name: 'Transfer',
      type: 'event'
    },
    // Payout event
    {
      anonymous: false,
      inputs: [
        {
          indexed: true,
          name: 'tokenId',
          type: 'uint256'
        },
        {
          indexed: false,
          name: 'amount',
          type: 'uint256'
        }
      ],
      name: 'Payout',
      type: 'event'
    },
    // Opening event
    {
      anonymous: false,
      inputs: [
        {
          indexed: true,
          name: 'tokenId',
          type: 'uint256'
        }
      ],
      name: 'Opening',
      type: 'event'
    },
    // Outcome event
    {
      anonymous: false,
      inputs: [
        {
          indexed: true,
          name: 'tokenId',
          type: 'uint256'
        },
        {
          indexed: false,
          name: 'level',
          type: 'uint256'
        },
        {
          indexed: false,
          name: 'roll',
          type: 'uint256'
        }
      ],
      name: 'Outcome',
      type: 'event'
    },
    // Minting Details event
    {
      anonymous: false,
      inputs: [
        {
          indexed: true,
          name: 'tokenId',
          type: 'uint256'
        },
        {
          indexed: false,
          name: 'level',
          type: 'uint256'
        },
        {
          indexed: false,
          name: 'details',
          type: 'string'
        }
      ],
      name: 'MintingDetails',
      type: 'event'
    },
    // Ticket Opening event
    {
      anonymous: false,
      inputs: [
        {
          indexed: true,
          name: 'tokenId',
          type: 'uint256'
        },
        {
          indexed: true,
          name: 'opener',
          type: 'address'
        }
      ],
      name: 'TicketOpeningInitiated',
      type: 'event'
    },
    // Ticket Resolution event
    {
      anonymous: false,
      inputs: [
        {
          indexed: true,
          name: 'tokenId',
          type: 'uint256'
        },
        {
          indexed: false,
          name: 'rollResult',
          type: 'uint256'
        },
        {
          indexed: false,
          name: 'winAmount',
          type: 'uint256'
        }
      ],
      name: 'TicketResolved',
      type: 'event'
    },
    // Reward Paid event
    {
      anonymous: false,
      inputs: [
        {
          indexed: true,
          name: 'winner',
          type: 'address'
        },
        {
          indexed: true,
          name: 'tokenId',
          type: 'uint256'
        },
        {
          indexed: false,
          name: 'amount',
          type: 'uint256'
        }
      ],
      name: 'RewardPaid',
      type: 'event'
    }
  ],
  // Add your contract addresses here
  contractAddresses: [
    '0xE64Ea2215CD88a5d3cfe764bCEB2c1e3C60ECfC4',
    '0x99A8374c5cf5E45151102F367ada3B47F636951c'
  ]
};

// Helper function to update ERC404 fungible balance
async function updateERC404FungibleBalance(address, amount, isAddition) {
  let balance = await ERC404Fungible.findOne({ address });
  
  if (!balance) {
    balance = new ERC404Fungible({ address, balance: '0' });
  }

  const currentBalance = BigInt(balance.balance);
  const amountBigInt = BigInt(amount);
  
  balance.balance = isAddition 
    ? (currentBalance + amountBigInt).toString()
    : (currentBalance - amountBigInt).toString();

  await balance.save();
}

// Webhook endpoint to receive Moralis Stream events
app.post('/webhook', async (req, res) => {
  try {
    const { confirmed, nftTransfers, erc20Transfers, block, logs } = req.body;
    
    if (confirmed) {
      console.log('Skipping confirmed transaction');
      return res.status(200).json({ message: 'Skipped confirmed transaction' });
    }

    // Get transaction hash from the first transfer
    const transactionHash = nftTransfers?.[0]?.transactionHash || erc20Transfers?.[0]?.transactionHash;
    
    if (!transactionHash) {
      console.log('No transaction hash found in transfers');
      return res.status(200).json({ message: 'No transaction hash found' });
    }

    // Check if transaction was already processed
    const existingTransaction = await ProcessedTransaction.findOne({ transactionHash });
    if (existingTransaction) {
      console.log('Transaction already processed:', transactionHash);
      return res.status(200).json({ message: 'Transaction already processed' });
    }

    // Validate contract addresses
    const erc721Address = streamConfig.contractAddresses[0];
    const erc404Address = streamConfig.contractAddresses[1];

    if (!erc721Address || !erc404Address) {
      console.log('Contract addresses not configured');
      return res.status(200).json({ message: 'Contract addresses not configured' });
    }

    // Process NFT transfers (both ERC721 and ERC404)
    if (nftTransfers && nftTransfers.length > 0) {
      // Track processed token IDs for this transaction to avoid duplicates
      const processedTokenIds = new Set();

      for (const transfer of nftTransfers) {
        const { contract, tokenId, from, to } = transfer;
        
        if (!contract || !tokenId || !from || !to) {
          console.log('Invalid transfer data:', transfer);
          continue;
        }

        // Skip if we've already processed this token ID in this transaction
        if (processedTokenIds.has(tokenId)) {
          console.log(`Skipping duplicate token ID: ${tokenId}`);
          continue;
        }

        // Determine token type based on contract address
        const isERC721 = contract.toLowerCase() === erc721Address.toLowerCase();
        const isERC404 = contract.toLowerCase() === erc404Address.toLowerCase();

        if (isERC721) {
          console.log(`ERC721 Transfer: Token ${tokenId} from ${from} to ${to}`);
          // Handle ERC721 transfer
          if (from !== '0x0000000000000000000000000000000000000000') {
            await ERC721Holding.findOneAndDelete({ tokenId });
          }
          await ERC721Holding.create({ tokenId, owner: to.toLowerCase() });
        } else if (isERC404) {
          console.log(`ERC404 NFT Transfer: Token ${tokenId} from ${from} to ${to}`);
          // Handle ERC404 NFT transfer
          if (from !== '0x0000000000000000000000000000000000000000') {
            await ERC404NFT.findOneAndDelete({ tokenId });
          }
          await ERC404NFT.create({ tokenId, owner: to.toLowerCase() });
          // Mark this token ID as processed
          processedTokenIds.add(tokenId);
        }
      }
    }

    // Process ERC20 transfers (for ERC404 fungible)
    if (erc20Transfers && erc20Transfers.length > 0) {
      for (const transfer of erc20Transfers) {
        const { contract, from, to, value } = transfer;
        
        if (!contract || !from || !to || !value) {
          console.log('Invalid transfer data:', transfer);
          continue;
        }

        // Only process if it's our ERC404 contract
        if (contract.toLowerCase() === erc404Address.toLowerCase()) {
          console.log(`ERC404 Fungible Transfer: ${value} from ${from} to ${to}`);
          if (from !== '0x0000000000000000000000000000000000000000') {
            await updateERC404FungibleBalance(from.toLowerCase(), value, false);
          }
          await updateERC404FungibleBalance(to.toLowerCase(), value, true);
        }
      }
    }

    // Process events
    if (logs && logs.length > 0) {
      for (const log of logs) {
        try {
          const { address, data, topic0, topic1, topic2, topic3 } = log;
          
          // Skip if no topic0 (event signature)
          if (!topic0) {
            console.log('Log has no event signature:', log);
            continue;
          }

          // Determine token type based on contract address
          const isERC721 = address.toLowerCase() === erc721Address.toLowerCase();
          const isERC404 = address.toLowerCase() === erc404Address.toLowerCase();
          const tokenType = isERC721 ? 'ERC721' : isERC404 ? 'ERC404' : null;

          if (!tokenType) {
            console.log('Unknown contract for event:', address);
            continue;
          }

          // Try to decode each event type
          let decodedLog = null;
          let eventName = null;

          // Try TicketMinted first since it's the most important for minting data
          try {
            decodedLog = interfaces.TicketMinted.parseLog({ 
              data, 
              topics: [topic0, topic1, topic2, topic3].filter(Boolean) 
            });
            eventName = 'TicketMinted';
          } catch (e) {
            // Try TicketOpeningInitiated
            try {
              decodedLog = interfaces.TicketOpeningInitiated.parseLog({ 
                data, 
                topics: [topic0, topic1, topic2, topic3].filter(Boolean) 
              });
              eventName = 'TicketOpeningInitiated';
            } catch (e) {
              // Try TicketResolved
              try {
                decodedLog = interfaces.TicketResolved.parseLog({ 
                  data, 
                  topics: [topic0, topic1, topic2, topic3].filter(Boolean) 
                });
                eventName = 'TicketResolved';
              } catch (e) {
                // Try RewardPaid
                try {
                  decodedLog = interfaces.RewardPaid.parseLog({ 
                    data, 
                    topics: [topic0, topic1, topic2, topic3].filter(Boolean) 
                  });
                  eventName = 'RewardPaid';
                } catch (e) {
                  // Try PoolDeposited
                  try {
                    decodedLog = interfaces.PoolDeposited.parseLog({ 
                      data, 
                      topics: [topic0, topic1, topic2, topic3].filter(Boolean) 
                    });
                    eventName = 'PoolDeposited';
                  } catch (e) {
                    // Try PoolWithdrawn
                    try {
                      decodedLog = interfaces.PoolWithdrawn.parseLog({ 
                        data, 
                        topics: [topic0, topic1, topic2, topic3].filter(Boolean) 
                      });
                      eventName = 'PoolWithdrawn';
                    } catch (e) {
                    //   console.log('Could not decode log:', log);
                      continue;
                    }
                  }
                }
              }
            }
          }

          if (!decodedLog || !eventName) continue;

          const { args } = decodedLog;

          if (eventName === 'TicketMinted') {
            const tokenId = args.tokenId.toString();
            const levels = args.levels;
            console.log(`Ticket Minted Event: Token ${tokenId} with ${levels.length} levels`);
            
            // Find existing minting details or create new one
            let mintingDetails = await MintingDetails.findOne({ tokenId });
            
            if (!mintingDetails) {
              mintingDetails = new MintingDetails({
                tokenId,
                levels: [],
                transactionHash,
                timestamp: new Date()
              });
            }

            // Add all level data
            for (const level of levels) {
              mintingDetails.levels.push({
                winAmount: level.winAmount.toString(),
                rollNumber: level.rollNumber.toNumber()
              });
            }

            await mintingDetails.save();
            console.log('Saved minting details:', mintingDetails);
            
            // Broadcast the update
            broadcastUpdate('MINTING_DETAILS_UPDATED', { tokenId });
          } else if (eventName === 'TicketOpeningInitiated') {
            const tokenId = args.tokenId.toString();
            const opener = args.opener.toLowerCase();
            console.log(`Opening Event: Token ${tokenId} by ${opener}`);
            await Opening.create({
              tokenId,
              opener,
              transactionHash,
              tokenType
            });
          } else if (eventName === 'TicketResolved' || eventName === 'RewardPaid') {
            const tokenId = args.tokenId.toString();
            let winAmount = '0';
            let rollResult = 0;

            if (eventName === 'TicketResolved') {
              winAmount = args.winAmount.toString();
              rollResult = args.rollResult.toNumber();
            } else if (eventName === 'RewardPaid') {
              winAmount = args.amount.toString();
            }
            
            console.log(`${eventName} Event: Token ${tokenId} Roll ${rollResult} Amount ${winAmount}`);
            
            // Find existing minting details or create new one
            let mintingDetails = await MintingDetails.findOne({ tokenId });
            
            if (!mintingDetails) {
              mintingDetails = new MintingDetails({
                tokenId,
                levels: [],
                transactionHash
              });
            }

            // Update roll result and payout
            mintingDetails.rollResult = rollResult;
            mintingDetails.payout = winAmount;

            await mintingDetails.save();
            
            // Broadcast the update
            broadcastUpdate('MINTING_DETAILS_UPDATED', { tokenId });
          } else if (eventName === 'PoolDeposited' || eventName === 'PoolWithdrawn') {
            const amount = args.amount.toString();
            console.log(`${eventName} Event: Amount ${amount}`);
          }
        } catch (error) {
          console.error('Error processing log:', error);
          continue;
        }
      }
    }

    // Record the processed transaction
    await ProcessedTransaction.create({ transactionHash });

    console.log('Transaction processed successfully:', transactionHash);
    res.status(200).json({ message: 'Holdings updated successfully' });
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(200).json({ message: 'Error occurred but returning 200 to prevent retries' });
  }
});

// Get all holdings for an address
app.get('/holdings/:address', async (req, res) => {
  try {
    const { address } = req.params;
    const addressLower = address.toLowerCase();

    // Get ERC404 fungible balance
    const fungibleBalance = await ERC404Fungible.findOne({ address: addressLower }) || { balance: '0' };

    // Get ERC404 NFTs
    const erc404NFTs = await ERC404NFT.find({ owner: addressLower });

    // Get ERC721 tokens
    const erc721Tokens = await ERC721Holding.find({ owner: addressLower });

    res.json({
      erc404: {
        fungible: fungibleBalance.balance,
        nfts: erc404NFTs.map(nft => nft.tokenId)
      },
      erc721: erc721Tokens.map(token => token.tokenId)
    });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching holdings' });
  }
});

// Get all holders of a specific token type
app.get('/holders/:tokenType', async (req, res) => {
  try {
    const { tokenType } = req.params;
    let holders;

    if (tokenType === 'erc404-fungible') {
      holders = await ERC404Fungible.find({ balance: { $gt: '0' } });
    } else if (tokenType === 'erc404-nft') {
      holders = await ERC404NFT.distinct('owner');
    } else if (tokenType === 'erc721') {
      holders = await ERC721Holding.distinct('owner');
    } else {
      return res.status(400).json({ error: 'Invalid token type' });
    }

    res.json(holders);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching holders' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Get openings for a token
app.get('/openings/:tokenId', async (req, res) => {
  try {
    const { tokenId } = req.params;
    const openings = await Opening.find({ tokenId }).sort({ timestamp: -1 });
    res.json(openings);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching openings' });
  }
});

// Get all openings for an address
app.get('/address/:address/openings', async (req, res) => {
  try {
    const { address } = req.params;
    const openings = await Opening.find({
      $or: [
        { 'tokenId': { $in: await ERC721Holding.find({ owner: address }).distinct('tokenId') } },
        { 'tokenId': { $in: await ERC404NFT.find({ owner: address }).distinct('tokenId') } }
      ]
    }).sort({ timestamp: -1 });
    res.json(openings);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching openings' });
  }
});

// Get minting details for a token
app.get('/minting-details/:tokenId', async (req, res) => {
  try {
    const { tokenId } = req.params;
    const details = await MintingDetails.findOne({ tokenId });
    res.json(details);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching minting details' });
  }
});

// Get all minting details for an address
app.get('/address/:address/minting-details', async (req, res) => {
  try {
    const { address } = req.params;
    console.log('Fetching minting details for address:', address);
    
    const tokenIds = await ERC721Holding.find({ owner: address }).distinct('tokenId');
    console.log('Found token IDs:', tokenIds);
    
    const details = await MintingDetails.find({
      'tokenId': { $in: tokenIds }
    })
    .sort({ timestamp: -1 })
    .lean(); // Use lean() for better performance
    
    console.log('Found minting details:', details.length);
    
    // Convert the data to match the frontend interface
    const formattedDetails = details.map(detail => ({
      ...detail,
      timestamp: detail.timestamp.toISOString(), // Convert Date to string
      rollResult: detail.rollResult || undefined,
      payout: detail.payout || undefined,
      levels: detail.levels.map(level => ({
        winAmount: level.winAmount,
        rollNumber: level.rollNumber
      }))
    }));

    res.json(formattedDetails);
  } catch (error) {
    console.error('Error fetching address minting details:', error);
    res.status(500).json({ error: 'Error fetching minting details' });
  }
});

// Get all minting details
app.get('/minting-details', async (req, res) => {
  try {
    console.log('Received request for minting details');
    console.log('Request headers:', req.headers);
    
    const details = await MintingDetails.find()
      .sort({ timestamp: -1 })
      .lean(); // Use lean() for better performance
    
    console.log('Found minting details:', details.length);
    
    // Convert the data to match the frontend interface
    const formattedDetails = details.map(detail => ({
      ...detail,
      timestamp: detail.timestamp.toISOString(), // Convert Date to string
      rollResult: detail.rollResult || undefined,
      payout: detail.payout || undefined,
      levels: detail.levels.map(level => ({
        winAmount: level.winAmount,
        rollNumber: level.rollNumber
      }))
    }));

    // Set proper headers
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
    res.setHeader('Access-Control-Allow-Credentials', 'false');

    console.log('Sending response with', formattedDetails.length, 'details');
    res.json(formattedDetails);
  } catch (error) {
    console.error('Error fetching all minting details:', error);
    res.status(500).json({ error: 'Error fetching minting details' });
  }
});

// Add a test endpoint
app.get('/test', (req, res) => {
  console.log('Test endpoint hit');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
  res.setHeader('Access-Control-Allow-Credentials', 'false');
  res.json({ message: 'Server is running' });
});

// Create HTTP server
const server = app.listen(process.env.PORT || 3001, () => {
  console.log(`Server running on port ${process.env.PORT || 3001}`);
});

// Update WebSocket server configuration
const wss = new WebSocket.Server({ 
  server,
  path: '/ws',
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// WebSocket connection handling
wss.on('connection', (ws) => {
  console.log('Client connected');

  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

// Function to broadcast updates to all connected clients
function broadcastUpdate(type, data) {
  console.log('Broadcasting update:', type, data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type, data }));
    }
  });
}

// Export the app for Vercel
module.exports = app; 