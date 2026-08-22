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

// 1. Cloudinary Setup
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
// 3. DATABASE SCHEMAS (Advanced)
// ==========================================
const customerSchema = new mongoose.Schema({
    name: { type: String, required: true },
    phone: { type: String, required: true, unique: true }, 
    createdAt: { type: Date, default: Date.now }
});
const Customer = mongoose.model('Customer', customerSchema);

const shopSchema = new mongoose.Schema({
    shopName: { type: String, required: true },
    ownerName: { type: String, required: true },
    phone: { type: String, required: true, unique: true }, 
    address: { type: String, required: true },
    location: {
        type: { type: String, enum: ['Point'], default: 'Point' },
        coordinates: { type: [Number], required: true } 
    },
    services: [{ name: String, price: Number, duration: Number }],
    photos: { type: [String], validate: [v => v.length <= 5, 'Max 5 photos'] },
    
    // Naya: Timing & Status Features
    openingTime: { type: String, default: "09:00 AM" },
    closingTime: { type: String, default: "09:00 PM" },
    isOpenToday: { type: Boolean, default: true },

    rating: { type: Number, default: 5.0 },
    createdAt: { type: Date, default: Date.now }
});
shopSchema.index({ location: '2dsphere' });
const Shop = mongoose.model('Shop', shopSchema);

const bookingSchema = new mongoose.Schema({
    shopId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shop' },
    customerName: String,
    customerPhone: String, 
    tokenNumber: { type: String, required: true }, 
    serviceName: String,
    price: Number,
    duration: Number,
    expectedTime: Date, 
    status: { type: String, enum: ['Waiting', 'Completed'], default: 'Waiting' }
});
const Booking = mongoose.model('Booking', bookingSchema);

// Helper Function: Cloudinary se Photo Delete Karne ke liye
async function deleteImagesFromCloudinary(imageUrls) {
    for (let imgUrl of imageUrls) {
        if (imgUrl.includes('cloudinary.com')) {
            const urlParts = imgUrl.split('/');
            const filename = urlParts[urlParts.length - 1].split('.')[0];
            const folder = urlParts[urlParts.length - 2]; 
            await cloudinary.uploader.destroy(`${folder}/${filename}`);
        }
    }
}

// ==========================================
// 4. REST APIs
// ==========================================

// API: Fetch Nearby Shops (50 KM Radius)
app.get('/api/shops/nearby', async (req, res) => {
  const userLat = parseFloat(req.query.lat);
  const userLng = parseFloat(req.query.lng);

  try {
      const shops = await Shop.find({
          location: {
              $near: {
                  $geometry: { type: "Point", coordinates: [userLng, userLat] },
                  $maxDistance: 50000 
              }
          }
      });

      const nearby = await Promise.all(shops.map(async (shop) => {
          const activeBookings = await Booking.find({ shopId: shop._id, status: 'Waiting' });
          
          const R = 6371; 
          const dLat = (shop.location.coordinates[1] - userLat) * Math.PI / 180;
          const dLon = (shop.location.coordinates[0] - userLng) * Math.PI / 180;
          const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                    Math.cos(userLat * Math.PI / 180) * Math.cos(shop.location.coordinates[1] * Math.PI / 180) * 
                    Math.sin(dLon/2) * Math.sin(dLon/2);
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
          
          return { ...shop._doc, distanceKm: (R * c).toFixed(2), queue: activeBookings };
      }));
      res.json(nearby);
  } catch(err) {
      res.status(500).json({ error: "Database error" });
  }
});

// API: Register New Salon
app.post('/api/shops/register', upload.array('photos', 5), async (req, res) => {
  const { name, ownerName, phone, address, lat, lng, services, openingTime, closingTime } = req.body;
  const imagePaths = req.files ? req.files.map(f => f.path) : [];

  try {
      const newShop = new Shop({
        shopName: name, ownerName, phone, address,
        openingTime, closingTime,
        location: { type: 'Point', coordinates: [parseFloat(lng), parseFloat(lat)] },
        services: JSON.parse(services || '[]'),
        photos: imagePaths
      });
      await newShop.save();
      res.status(201).json({ success: true, shopId: newShop._id });
  } catch(err) {
      res.status(500).json({ error: "Registration Failed." });
  }
});

// API: Update Salon (Edit Profile & Auto-Delete Old Photos)
app.put('/api/shops/:id', upload.array('photos', 5), async (req, res) => {
    try {
        const shop = await Shop.findById(req.params.id);
        if (!shop) return res.status(404).json({ error: "Shop not found" });

        const { name, ownerName, phone, address, services, openingTime, closingTime, isOpenToday } = req.body;
        
        // Agar nayi photos aayi hain, toh purani Cloudinary se delete karo
        if (req.files && req.files.length > 0) {
            await deleteImagesFromCloudinary(shop.photos);
            shop.photos = req.files.map(f => f.path);
        }

        // Baki details update karo
        shop.shopName = name;
        shop.ownerName = ownerName;
        shop.phone = phone;
        shop.address = address;
        shop.openingTime = openingTime;
        shop.closingTime = closingTime;
        shop.isOpenToday = (isOpenToday === 'true');
        shop.services = JSON.parse(services || '[]');

        await shop.save();
        res.json({ success: true, message: "Profile Updated & Old Data Cleaned!" });
    } catch (err) {
        res.status(500).json({ error: "Update Failed" });
    }
});

// API: Delete Entire Salon
app.delete('/api/shops/:id', async (req, res) => {
    try {
        const shop = await Shop.findById(req.params.id);
        if (shop) {
            await deleteImagesFromCloudinary(shop.photos); // Cloudinary se kachra saaf
            await Shop.findByIdAndDelete(req.params.id); // MongoDB se saaf
            res.json({ success: true });
        }
    } catch (err) {
        res.status(500).json({ error: "Delete Failed" });
    }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ==========================================
// 5. SOCKET.IO (Live Queue)
// ==========================================
io.on('connection', (socket) => {
  socket.on('join_shop', (shopId) => socket.join(shopId));

  socket.on('book_appointment', async ({ shopId, customerName, customerPhone, serviceName, duration }) => {
    try {
        const shop = await Shop.findById(shopId);
        if (shop && shop.isOpenToday) {
          const activeBookings = await Booking.find({ shopId: shopId, status: 'Waiting' });
          const totalWaitMinutes = activeBookings.reduce((acc, curr) => acc + curr.duration, 0);
          const appointmentTime = new Date(Date.now() + (totalWaitMinutes * 60000));
          
          const newBooking = new Booking({
              shopId: shop._id,
              tokenNumber: "TKN-" + Math.floor(1000 + Math.random() * 9000),
              customerName, customerPhone, serviceName,
              duration: parseInt(duration),
              expectedTime: appointmentTime
          });
          await newBooking.save();

          const updatedBookings = await Booking.find({ shopId: shopId, status: 'Waiting' });
          io.to(shopId).emit('queue_updated', { queue: updatedBookings, shopId });
          socket.emit('booking_confirmed', { 
              tokenNumber: newBooking.tokenNumber, 
              appointmentTime: appointmentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
          });
        }
    } catch(err) {}
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server live on ${PORT}`));