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
    
    openingTime: { type: String, default: "09:00" }, 
    closingTime: { type: String, default: "21:00" },
    slotDuration: { type: Number, default: 30 }, 
    chairs: { type: Number, default: 1 }, 
    closedDates: { type: [String], default: [] },
    
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
    bookingDate: { type: String, required: true }, 
    timeSlot: { type: String, required: true }, 
    expireAt: { type: Date, required: true } 
});
// Zero Garbage: Delete booking automatically at Midnight
bookingSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });
const Booking = mongoose.model('Booking', bookingSchema);

async function deleteImagesFromCloudinary(imageUrls) {
    if(!imageUrls || imageUrls.length === 0) return;
    for (let imgUrl of imageUrls) {
        if (imgUrl.includes('cloudinary.com')) {
            const urlParts = imgUrl.split('/');
            const filename = urlParts[urlParts.length - 1].split('.')[0];
            const folder = urlParts[urlParts.length - 2]; 
            await cloudinary.uploader.destroy(`${folder}/${filename}`);
        }
    }
}

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
app.get('/api/shops/:id/slots', async (req, res) => {
    try {
        const dateStr = req.query.date; 
        const shop = await Shop.findById(req.params.id);
        if (!shop) return res.status(404).json({ error: "Shop not found" });

        if (shop.closedDates && shop.closedDates.includes(dateStr)) {
            return res.json({ slots: [], bookings: [], isClosed: true });
        }

        let startMins = timeToMins(shop.openingTime);
        let endMins = timeToMins(shop.closingTime);
        let duration = shop.slotDuration;
        let capacity = shop.chairs;

        let slots = [];
        for (let t = startMins; t + duration <= endMins; t += duration) {
            slots.push({ time: `${minsToTime(t)} - ${minsToTime(t + duration)}`, total: capacity, available: capacity });
        }

        const bookings = await Booking.find({ shopId: shop._id, bookingDate: dateStr }).sort({ createdAt: 1 });
        bookings.forEach(b => {
            let s = slots.find(slot => slot.time === b.timeSlot);
            if(s && s.available > 0) s.available--;
        });

        res.json({ slots, bookings, isClosed: false });
    } catch (err) { res.status(500).json({ error: "Failed to load slots" }); }
});

app.get('/api/shops/nearby', async (req, res) => {
  const userLat = parseFloat(req.query.lat);
  const userLng = parseFloat(req.query.lng);
  try {
      const shops = await Shop.find({
          location: { $near: { $geometry: { type: "Point", coordinates: [userLng, userLat] }, $maxDistance: 50000 } }
      });

      const nearby = await Promise.all(shops.map(async (shop) => {
          const R = 6371; 
          const dLat = (shop.location.coordinates[1] - userLat) * Math.PI / 180;
          const dLon = (shop.location.coordinates[0] - userLng) * Math.PI / 180;
          const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(userLat * Math.PI / 180) * Math.cos(shop.location.coordinates[1] * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
          return { ...shop._doc, distanceKm: (R * c).toFixed(2) };
      }));
      res.json(nearby);
  } catch(err) { res.status(500).json({ error: "Database error" }); }
});

app.post('/api/shops/register', upload.array('photos', 5), async (req, res) => {
  const { name, ownerName, phone, address, lat, lng, services, openingTime, closingTime, slotDuration, chairs, closedDates } = req.body;
  try {
      const newShop = new Shop({
        shopName: name, ownerName, phone, address,
        openingTime, closingTime, 
        slotDuration: parseInt(slotDuration) || 30, chairs: parseInt(chairs) || 1,
        closedDates: JSON.parse(closedDates || '[]'),
        location: { type: 'Point', coordinates: [parseFloat(lng), parseFloat(lat)] },
        services: JSON.parse(services || '[]'),
        photos: req.files ? req.files.map(f => f.path) : []
      });
      await newShop.save();
      res.status(201).json({ success: true, shopId: newShop._id });
  } catch(err) { res.status(500).json({ error: "Registration Failed." }); }
});

// BUG FIX 1: Robust Edit Settings Route
app.put('/api/shops/:id', upload.array('photos', 5), async (req, res) => {
    try {
        const shop = await Shop.findById(req.params.id);
        if (!shop) return res.status(404).json({ error: "Shop not found" });

        const { name, ownerName, phone, address, lat, lng, services, openingTime, closingTime, slotDuration, chairs, closedDates, isOpenToday } = req.body;
        
        // Handle Photos Safe Replacement
        if (req.files && req.files.length > 0) {
            if(shop.photos && shop.photos.length > 0) {
                await deleteImagesFromCloudinary(shop.photos);
            }
            shop.photos = req.files.map(f => f.path);
        }

        // Update All other fields explicitly
        shop.shopName = name; 
        shop.ownerName = ownerName; 
        shop.phone = phone; 
        shop.address = address;
        if(lat && lng) {
            shop.location = { type: 'Point', coordinates: [parseFloat(lng), parseFloat(lat)] };
        }
        shop.openingTime = openingTime; 
        shop.closingTime = closingTime;
        shop.slotDuration = parseInt(slotDuration) || 30; 
        shop.chairs = parseInt(chairs) || 1;
        
        try { shop.closedDates = JSON.parse(closedDates || '[]'); } catch(e){}
        try { shop.services = JSON.parse(services || '[]'); } catch(e){}
        
        shop.isOpenToday = (isOpenToday === 'true');

        await shop.save();
        res.json({ success: true });
    } catch (err) { 
        console.error(err);
        res.status(500).json({ error: "Update Failed on Server" }); 
    }
});

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
// 5. SOCKET.IO (Booking Logic)
// ==========================================
io.on('connection', (socket) => {
  socket.join('global');

  socket.on('book_appointment', async ({ shopId, customerName, customerPhone, serviceName, bookingDate, timeSlot }) => {
    try {
        const shop = await Shop.findById(shopId);
        if (shop) {
          // Expiry safe buffer (Delete precisely after the day ends)
          const expireDate = new Date(bookingDate);
          expireDate.setDate(expireDate.getDate() + 1); 
          expireDate.setHours(2, 0, 0, 0); 

          const newBooking = new Booking({
              shopId: shop._id,
              tokenNumber: "TKN-" + Math.floor(1000 + Math.random() * 9000),
              customerName, customerPhone, serviceName,
              bookingDate, timeSlot, expireAt: expireDate 
          });
          await newBooking.save();

          io.emit('slot_booked', { shopId, bookingDate });
          
          socket.emit('booking_confirmed', { 
              tokenNumber: newBooking.tokenNumber, 
              appointmentTime: `${bookingDate} | ${timeSlot}`,
              shopName: shop.shopName,
              shopAddress: shop.address,
              shopPhone: shop.phone 
          });
        }
    } catch(err) { console.log(err); }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server live on ${PORT}`));