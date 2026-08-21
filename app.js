const socket = io();
let userLat = 28.6139;
let userLng = 77.2090;
let map, userMarker;
let selectedShop = null;
let selectedService = null;

// Initialize Leaflet Map
function initMap() {
  map = L.map('map').setView([userLat, userLng], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19
  }).addTo(map);
  userMarker = L.marker([userLat, userLng]).addTo(map).bindPopup("Aap yahan hain!").openPopup();
}

// Get Geolocation
function getUserLocation() {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        userLat = pos.coords.latitude;
        userLng = pos.coords.longitude;
        document.getElementById('location-text').innerText = `${userLat.toFixed(3)}, ${userLng.toFixed(3)}`;
        if (map) {
          map.setView([userLat, userLng], 14);
          userMarker.setLatLng([userLat, userLng]);
        }
        fetchNearbyShops();
      },
      () => {
        document.getElementById('location-text').innerText = "Default (Delhi)";
        fetchNearbyShops();
      }
    );
  }
}

// Get Location Automatically for Registration Form
function getCurrentLocationForReg() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((pos) => {
            document.getElementById('reg-lat').value = pos.coords.latitude;
            document.getElementById('reg-lng').value = pos.coords.longitude;
        });
    } else {
        alert("Location access denied ya support nahi karti.");
    }
}

// Add Dynamic Service Row in Form
function addServiceRow() {
    const container = document.getElementById('dynamic-services');
    const row = document.createElement('div');
    row.className = "flex space-x-2 service-row";
    row.innerHTML = `
        <input type="text" placeholder="Service Name" class="s-name w-1/2 bg-slate-800 p-2 rounded text-xs text-white border border-slate-600">
        <input type="number" placeholder="₹ Price" class="s-price w-1/4 bg-slate-800 p-2 rounded text-xs text-white border border-slate-600">
        <input type="number" placeholder="Mins" class="s-dur w-1/4 bg-slate-800 p-2 rounded text-xs text-white border border-slate-600">
    `;
    container.appendChild(row);
}

// Fetch Nearby Shops from Backend API (Uses the new 50KM radius logic)
async function fetchNearbyShops() {
  const res = await fetch(`/api/shops/nearby?lat=${userLat}&lng=${userLng}`);
  const shops = await res.json();
  
  const container = document.getElementById('shop-list');
  container.innerHTML = '';

  if(shops.length === 0) {
      container.innerHTML = '<p class="text-slate-400 text-sm text-center">Aas-paas koi salon nahi mila.</p>';
      return;
  }

  shops.forEach(shop => {
    // Add Marker on Map
    L.marker([shop.lat, shop.lng]).addTo(map).bindPopup(`<b>${shop.name}</b>`);

    // Build services preview text (taaki bahar se hi rate list dikhe)
    let servicesText = shop.services.map(s => s.name).join(', ');
    if(servicesText.length > 30) servicesText = servicesText.substring(0, 30) + '...';
    
    // Render Cards
    const card = document.createElement('div');
    card.className = "bg-slate-800 p-4 rounded-xl border border-slate-700 flex flex-col space-y-3";
    card.innerHTML = `
      <div class="flex space-x-3">
        <img src="${shop.images[0]}" class="w-24 h-24 rounded-lg object-cover border border-slate-600">
        <div class="flex-1">
          <h3 class="font-bold text-lg text-amber-400 leading-tight">${shop.name}</h3>
          <p class="text-xs text-slate-400 mt-1">📍 ${shop.address} <br><span class="text-amber-500 font-semibold">(${shop.distanceKm} km away)</span></p>
          <p class="text-xs text-slate-300 mt-1 font-medium">✂️ ${servicesText || 'No services listed'}</p>
          <div class="flex items-center space-x-2 mt-2">
            <span class="text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded font-bold">★ ${shop.rating || 5.0}</span>
            <span class="text-xs text-white bg-slate-700 px-2 py-0.5 rounded shadow">👥 Queue: ${shop.queue.length}</span>
          </div>
        </div>
      </div>
      <button onclick="openBookingModal('${shop.id}')" class="w-full bg-slate-700 hover:bg-amber-500 hover:text-slate-900 text-amber-400 text-sm font-bold py-2.5 rounded-lg border border-slate-600 transition">
        Book Appointment & Get Token
      </button>
    `;
    container.appendChild(card);
  });
}

// Open Booking Modal
async function openBookingModal(shopId) {
  const res = await fetch(`/api/shops/nearby?lat=${userLat}&lng=${userLng}`);
  const shops = await res.json();
  selectedShop = shops.find(s => s.id === shopId);

  socket.emit('join_shop', shopId);

  document.getElementById('modal-shop-name').innerText = selectedShop.name;
  document.getElementById('modal-queue-count').innerText = selectedShop.queue.length;
  
  const totalWait = selectedShop.queue.reduce((acc, curr) => acc + curr.duration, 0);
  document.getElementById('modal-wait-time').innerText = `${totalWait} mins`;

  const serviceContainer = document.getElementById('services-list');
  serviceContainer.innerHTML = '<p class="text-sm font-semibold text-slate-300">Select Service:</p>';

  if(selectedShop.services && selectedShop.services.length > 0) {
      selectedShop.services.forEach((s, idx) => {
        serviceContainer.innerHTML += `
          <label class="flex items-center justify-between bg-slate-900 p-3 rounded-lg border border-slate-700 cursor-pointer hover:border-amber-500 transition">
            <div class="flex items-center space-x-3">
              <input type="radio" name="service" value="${idx}" onchange="selectedService = selectedShop.services[${idx}]" class="accent-amber-500 w-4 h-4">
              <div>
                  <p class="text-sm font-bold text-white">${s.name}</p>
                  <p class="text-xs text-slate-400">⏱️ ${s.duration} mins</p>
              </div>
            </div>
            <span class="text-sm font-bold text-amber-400">₹${s.price}</span>
          </label>
        `;
      });
  } else {
      serviceContainer.innerHTML += `<p class="text-xs text-red-400">No services available</p>`;
  }

  document.getElementById('booking-modal').classList.remove('hidden');
  document.getElementById('booking-modal').classList.add('flex');
}

function closeBookingModal() {
  document.getElementById('booking-modal').classList.add('hidden');
  document.getElementById('booking-modal').classList.remove('flex');
}

function toggleRegisterModal() {
  const modal = document.getElementById('register-modal');
  modal.classList.toggle('hidden');
  modal.classList.toggle('flex');
}

function closeTokenModal() {
    document.getElementById('token-modal').classList.add('hidden');
    document.getElementById('token-modal').classList.remove('flex');
}

// Submit Registration (Advanced: Photos + Multiple Services Array)
async function submitRegisterShop() {
  const name = document.getElementById('reg-name').value;
  const owner = document.getElementById('reg-owner').value;
  const phone = document.getElementById('reg-phone').value;
  const address = document.getElementById('reg-address').value;
  const lat = document.getElementById('reg-lat').value;
  const lng = document.getElementById('reg-lng').value;
  const photoInput = document.getElementById('reg-photos');
  const btn = document.getElementById('submit-btn');

  if (!name || !owner || !phone || !address || !lat || !lng) {
    alert("Kripya saari details bharein!");
    return;
  }

  // Compile Services into an Array
  const servicesArray = [];
  const rows = document.querySelectorAll('.service-row');
  rows.forEach(row => {
      const sName = row.querySelector('.s-name').value;
      const sPrice = row.querySelector('.s-price').value;
      const sDur = row.querySelector('.s-dur').value;
      if(sName && sPrice && sDur) {
          servicesArray.push({ name: sName, price: parseInt(sPrice), duration: parseInt(sDur) });
      }
  });

  const formData = new FormData();
  formData.append('name', name);
  formData.append('ownerName', owner);
  formData.append('phone', phone);
  formData.append('address', address);
  formData.append('lat', lat);
  formData.append('lng', lng);
  formData.append('services', JSON.stringify(servicesArray));
  
  // Attach multiple photos safely (Max 10)
  for(let i = 0; i < photoInput.files.length; i++) {
      if(i < 10) { 
          formData.append('photos', photoInput.files[i]);
      }
  }

  try {
      btn.innerText = "Uploading Photos... Please wait";
      btn.disabled = true;

      const res = await fetch('/api/shops/register', {
          method: 'POST',
          body: formData
      });
      const data = await res.json();
      
      if(data.success) {
          alert("Salon Live Ho Gaya Hai!");
          toggleRegisterModal();
          fetchNearbyShops(); 
      } else {
          alert("Error: " + data.error);
      }
  } catch (err) {
      alert("Registration failed!");
  } finally {
      btn.innerText = "Save & Publish Salon";
      btn.disabled = false;
  }
}

// Submit Booking 
function confirmBooking() {
  const name = document.getElementById('cust-name').value;
  const phone = document.getElementById('cust-phone').value;
  
  if (!name || !phone || !selectedService) {
    alert('Kripya apna naam, mobile number aur service chunein!');
    return;
  }

  socket.emit('book_appointment', {
    shopId: selectedShop.id,
    customerName: name,
    customerPhone: phone, 
    serviceName: selectedService.name,
    duration: selectedService.duration
  });
}

// Show Token Modal beautifully when confirmed
socket.on('booking_confirmed', (data) => {
  closeBookingModal();
  
  document.getElementById('display-token').innerText = data.tokenNumber;
  document.getElementById('display-time').innerText = data.appointmentTime;
  
  document.getElementById('token-modal').classList.remove('hidden');
  document.getElementById('token-modal').classList.add('flex');
  
  fetchNearbyShops();
});

socket.on('queue_updated', ({ queue, shopId }) => {
  if (selectedShop && selectedShop.id === shopId) {
    document.getElementById('modal-queue-count').innerText = queue.length;
    const totalWait = queue.reduce((acc, curr) => acc + curr.duration, 0);
    document.getElementById('modal-wait-time').innerText = `${totalWait} mins`;
  }
});

// Initialize on Load
window.onload = () => {
  initMap();
  getUserLocation();
};