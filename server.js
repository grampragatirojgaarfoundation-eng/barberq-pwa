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

// 1. Cloudinary Setup (Auto-Compress to KBs)
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
    // Compress logic: reduce width and auto-adjust quality to keep size in low KBs
    transformation: [{ width: 800, crop: 'limit', quality: 'auto:eco', fetch_format: 'auto' }]
  }
});
const upload = multer({ storage: storage });

// 2. MongoDB Database Connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Database Connected Successfully!"))
  .catch(err => console.log("❌ MongoDB Connection Error:", err));

// ==========================================
// 3. DATABASE SCHEMAS
// ==========================================
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
    
    // UIDAI Style Slot Settings
    openingTime: { type: String, default: "09:00" }, // 24h format
    closingTime: { type: String, default: "21:00" },
    slotDuration: { type: Number, default: 30 }, // Ek slot kitne minutes ka hoga
    chairs: { type: Number, default: 1 }, // Ek time par kitne log (Available count)
    
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
    
    // Naya Slot System Data
    bookingDate: { type: String, required: true }, // 'YYYY-MM-DD'
    timeSlot: { type: String, required: true }, // '09:30 - 10:00'
    
    // AUTO-DELETE MAGIC (MongoDB TTL Index)
    expireAt: { type: Date, required: true } 
});
// Jaise hi expireAt ka time aayega, MongoDB is data ko automatically delete kar dega (Zero Garbage)
bookingSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });
const Booking = mongoose.model('Booking', bookingSchema);

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

// Helper: Time parser (e.g. "09:30" -> 570 mins)
const timeToMins = (timeStr) => {
    let [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
};
const minsToTime = (mins) => {
    let h = Math.floor(mins / 60).toString().padStart(2, '0');
    let m = (mins % 60).toString().padStart(2, '0');
    return `${h}:${m}`;
};

// ==========================================
// 4. REST APIs
// ==========================================

// UIDAI Slot Generator API
app.get('/api/shops/:id/slots', async (req, res) => {
    try {
        const dateStr = req.query.date; // YYYY-MM-DD
        const shop = await Shop.findById(req.params.id);
        if (!shop) return res.status(404).json({ error: "Shop not found" });

        let startMins = timeToMins(shop.openingTime);
        let endMins = timeToMins(shop.closingTime);
        let duration = shop.slotDuration;
        let capacity = shop.chairs;

        let slots = [];
        for (let t = startMins; t + duration <= endMins; t += duration) {
            let timeStr = `${minsToTime(t)} - ${minsToTime(t + duration)}`;
            slots.push({ time: timeStr, total: capacity, available: capacity });
        }

        // Fetch bookings for that date
        const bookings = await Booking.find({ shopId: shop._id, bookingDate: dateStr });
        bookings.forEach(b => {
            let s = slots.find(slot => slot.time === b.timeSlot);
            if(s && s.available > 0) s.available--;
        });

        // Add bookings list if owner is requesting (for Dashboard)
        res.json({ slots, bookings });
    } catch (err) {
        res.status(500).json({ error: "Failed to load slots" });
    }
});

// Fetch Nearby Shops
app.get('/api/shops/nearby', async (req, res) => {
  const userLat = parseFloat(req.query.lat);
  const userLng = parseFloat(req.query.lng);

  try {
      const shops = await Shop.find({
          location: {
              $near: { $geometry: { type: "Point", coordinates: [userLng, userLat] }, $maxDistance: 50000 }
          }
      });

      const nearby = await Promise.all(shops.map(async (shop) => {
          const R = 6371; 
          const dLat = (shop.location.coordinates[1] - userLat) * Math.PI / 180;
          const dLon = (shop.location.coordinates[0] - userLng) * Math.PI / 180;
          const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                    Math.cos(userLat * Math.PI / 180) * Math.cos(shop.location.coordinates[1] * Math.PI / 180) * 
                    Math.sin(dLon/2) * Math.sin(dLon/2);
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
          return { ...shop._doc, distanceKm: (R * c).toFixed(2) };
      }));
      res.json(nearby);
  } catch(err) { res.status(500).json({ error: "Database error" }); }
});

// Register New Salon
app.post('/api/shops/register', upload.array('photos', 5), async (req, res) => {
  const { name, ownerName, phone, address, lat, lng, services, openingTime, closingTime, slotDuration, chairs } = req.body;
  const imagePaths = req.files ? req.files.map(f => f.path) : [];

  try {
      const newShop = new Shop({
        shopName: name, ownerName, phone, address,
        openingTime, closingTime, 
        slotDuration: parseInt(slotDuration), chairs: parseInt(chairs),
        location: { type: 'Point', coordinates: [parseFloat(lng), parseFloat(lat)] },
        services: JSON.parse(services || '[]'),
        photos: imagePaths
      });
      await newShop.save();
      res.status(201).json({ success: true, shopId: newShop._id });
  } catch(err) { res.status(500).json({ error: "Registration Failed." }); }
});

// Update Salon
app.put('/api/shops/:id', upload.array('photos', 5), async (req, res) => {
    try {
        const shop = await Shop.findById(req.params.id);
        const { name, ownerName, phone, address, services, openingTime, closingTime, slotDuration, chairs, isOpenToday } = req.body;
        
        if (req.files && req.files.length > 0) {
            await deleteImagesFromCloudinary(shop.photos);
            shop.photos = req.files.map(f => f.path);
        }

        shop.shopName = name; shop.ownerName = ownerName; shop.phone = phone; shop.address = address;
        shop.openingTime = openingTime; shop.closingTime = closingTime;
        shop.slotDuration = parseInt(slotDuration); shop.chairs = parseInt(chairs);
        shop.isOpenToday = (isOpenToday === 'true');
        shop.services = JSON.parse(services || '[]');

        await shop.save();
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "Update Failed" }); }
});

// Delete Entire Salon
app.delete('/api/shops/:id', async (req, res) => {
    try {
        const shop = await Shop.findById(req.params.id);
        if (shop) {
            await deleteImagesFromCloudinary(shop.photos); 
            await Shop.findByIdAndDelete(req.params.id); 
            res.json({ success: true });
        }
    } catch (err) { res.status(500).json({ error: "Delete Failed" }); }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ==========================================
// 5. SOCKET.IO (Slot Booking Logic)
// ==========================================
io.on('connection', (socket) => {
  socket.join('global');

  socket.on('book_appointment', async ({ shopId, customerName, customerPhone, serviceName, bookingDate, timeSlot }) => {
    try {
        const shop = await Shop.findById(shopId);
        if (shop) {
          // Expiry Time Calculate karna (Jaise 15:00 ka slot 15:00 baje database se delete ho jayega)
          const endTimeStr = timeSlot.split(' - ')[1]; // Extract "15:00"
          // Indian Standard Time (IST) offset handle
          const expireDate = new Date(`${bookingDate}T${endTimeStr}:00+05:30`); 

          const newBooking = new Booking({
              shopId: shop._id,
              tokenNumber: "TKN-" + Math.floor(1000 + Math.random() * 9000),
              customerName, customerPhone, serviceName,
              bookingDate, timeSlot,
              expireAt: expireDate // Ye TTL trigger karega
          });
          await newBooking.save();

          // Refresh slots frontend par bhejo
          io.emit('slot_booked', { shopId, bookingDate });
          socket.emit('booking_confirmed', { 
              tokenNumber: newBooking.tokenNumber, 
              appointmentTime: `${bookingDate} | ${timeSlot}`
          });
        }
    } catch(err) { console.log(err); }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server live on ${PORT}`));