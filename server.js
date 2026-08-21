require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const mongoose = require('mongoose');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// 1. Cloudinary Configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'barberq_shops',
    allowed_formats: ['jpg', 'png', 'jpeg', 'webp'],
    transformation: [{ width: 1000, height: 1000, crop: 'limit', quality: 'auto', fetch_format: 'auto' }]
  }
});
const upload = multer({ storage: storage });

// 2. MongoDB Database Connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Database Connected Successfully!"))
  .catch(err => console.log("❌ MongoDB Connection Error:", err));

// ==========================================
// 3. ADVANCED DATABASE SCHEMAS (MODELS)
// ==========================================

// A. Customer Schema
const customerSchema = new mongoose.Schema({
    name: { type: String, required: true },
    phone: { type: String, required: true, unique: true }, 
    profilePhoto: { type: String, default: "" },
    isVerified: { type: Boolean, default: false }, 
    createdAt: { type: Date, default: Date.now }
});
const Customer = mongoose.model('Customer', customerSchema);

// B. Salon Owner Schema (Updated for 50KM radius)
const shopSchema = new mongoose.Schema({
    shopName: { type: String, required: true },
    ownerName: { type: String, required: true },
    phone: { type: String, required: true, unique: true }, 
    isVerified: { type: Boolean, default: false },
    description: { type: String, default: "" },
    address: { type: String, required: true },
    
    // GEO-SPATIAL Location
    location: {
        type: { type: String, enum: ['Point'], default: 'Point' },
        coordinates: { type: [Number], required: true } // [longitude, latitude]
    },

    services: [{
        name: String,
        price: Number,
        duration: Number
    }],

    photos: { type: [String], validate: [v => v.length <= 10, 'Max 10 photos'] },
    videos: { type: [String], validate: [v => v.length <= 2, 'Max 2 videos'] },
    
    rating: { type: Number, default: 0 },
    totalReviews: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now }
});
// 2dsphere index zaroori hai location search ke liye
shopSchema.index({ location: '2dsphere' });
const Shop = mongoose.model('Shop', shopSchema);

// C. Live Appointment / Token Schema
const bookingSchema = new mongoose.Schema({
    shopId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shop' },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
    customerName: String, // Direct name save karne ke liye (jab tak OTP login nahi banta)
    customerPhone: String, 
    tokenNumber: { type: String, required: true }, 
    serviceName: String,
    price: Number,
    duration: Number,
    expectedTime: Date, 
    status: { type: String, enum: ['Waiting', 'In-Progress', 'Completed', 'Cancelled'], default: 'Waiting' },
    createdAt: { type: Date, default: Date.now }
});
const Booking = mongoose.model('Booking', bookingSchema);

// D. Review & Rating Schema
const reviewSchema = new mongoose.Schema({
    shopId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shop' },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, default: "" },
    createdAt: { type: Date, default: Date.now }
});
const Review = mongoose.model('Review', reviewSchema);

// ==========================================
// 4. REST APIs (Updated for New Schemas)
// ==========================================

// API: Fetch Nearby Shops (Using MongoDB 50KM Geo-Spatial Search!)
app.get('/api/shops/nearby', async (req, res) => {
  const userLat = parseFloat(req.query.lat);
  const userLng = parseFloat(req.query.lng);

  try {
      // 50KM Radius Logic built into MongoDB
      const shops = await Shop.find({
          location: {
              $near: {
                  $geometry: { type: "Point", coordinates: [userLng, userLat] },
                  $maxDistance: 50000 // 50 KM in meters
              }
          }
      });

      // Format response so old frontend doesn't break
      const nearby = await Promise.all(shops.map(async (shop) => {
          // Calculate active queue from new Booking schema
          const activeBookings = await Booking.find({ shopId: shop._id, status: 'Waiting' });
          
          // Distance calc for display
          const R = 6371; 
          const dLat = (shop.location.coordinates[1] - userLat) * Math.PI / 180;
          const dLon = (shop.location.coordinates[0] - userLng) * Math.PI / 180;
          const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                    Math.cos(userLat * Math.PI / 180) * Math.cos(shop.location.coordinates[1] * Math.PI / 180) * 
                    Math.sin(dLon/2) * Math.sin(dLon/2);
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
          
          return { 
              id: shop._id,
              name: shop.shopName,
              address: shop.address,
              lat: shop.location.coordinates[1],
              lng: shop.location.coordinates[0],
              images: shop.photos.length ? shop.photos : ["https://images.unsplash.com/photo-1503951914875-452162b0f3f1?w=500"],
              rating: shop.rating,
              services: shop.services,
              distanceKm: (R * c).toFixed(2),
              queue: activeBookings
          };
      }));

      res.json(nearby);
  } catch(err) {
      console.log(err);
      res.status(500).json({ error: "Database error" });
  }
});

// API: Register New Salon
app.post('/api/shops/register', upload.array('photos', 10), async (req, res) => {
  const { name, ownerName, phone, lat, lng, address, services } = req.body;
  const imagePaths = req.files ? req.files.map(f => f.path) : [];

  try {
      const newShop = new Shop({
        shopName: name,
        ownerName: ownerName,
        phone: phone,
        address: address,
        location: {
            type: 'Point',
            coordinates: [parseFloat(lng), parseFloat(lat)] // GeoJSON is strictly [Lng, Lat]
        },
        services: JSON.parse(services || '[]'),
        photos: imagePaths
      });
      await newShop.save();
      res.status(201).json({ success: true });
  } catch(err) {
      console.log(err);
      res.status(500).json({ error: "Registration Failed. Phone number might already exist." });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ==========================================
// 5. SOCKET.IO (Live Booking updated for UIDAI Token System)
// ==========================================
io.on('connection', (socket) => {
  socket.on('join_shop', (shopId) => {
    socket.join(shopId);
  });

  socket.on('book_appointment', async ({ shopId, customerName, customerPhone, serviceName, duration }) => {
    try {
        const shop = await Shop.findById(shopId);
        if (shop) {
          // Calculate time based on current waiting list
          const activeBookings = await Booking.find({ shopId: shopId, status: 'Waiting' });
          const totalWaitMinutes = activeBookings.reduce((acc, curr) => acc + curr.duration, 0);
          const appointmentTime = new Date(Date.now() + (totalWaitMinutes * 60000));
          const timeString = appointmentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const tokenNumber = "TKN-" + Math.floor(1000 + Math.random() * 9000); 

          // Save to new Booking Collection
          const newBooking = new Booking({
              shopId: shop._id,
              tokenNumber: tokenNumber,
              customerName: customerName,
              customerPhone: customerPhone,
              serviceName: serviceName,
              duration: parseInt(duration),
              expectedTime: appointmentTime
          });
          await newBooking.save();

          // Fetch updated queue to broadcast
          const updatedBookings = await Booking.find({ shopId: shopId, status: 'Waiting' });
          
          io.to(shopId).emit('queue_updated', { queue: updatedBookings, shopId });
          socket.emit('booking_confirmed', { tokenNumber, appointmentTime: timeString });
        }
    } catch(err) {
        console.log(err);
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running live on port ${PORT}`);
});