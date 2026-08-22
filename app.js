const socket = io();
let userLat = 28.6139, userLng = 77.2090;
let map, userMarker, allShops = [], shopMarkers = {};
let selectedShop = null, selectedService = null, selectedSlotTime = null;
let ownerPhone = localStorage.getItem('barberq_owner_phone') || null;

const redIcon = new L.Icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png', iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34] });
const blueIcon = new L.Icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png', iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34] });

function initMap() {
  map = L.map('map').setView([userLat, userLng], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
  userMarker = L.marker([userLat, userLng], {icon: redIcon}).addTo(map).bindPopup("You");
}

function getUserLocation() {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => { userLat = pos.coords.latitude; userLng = pos.coords.longitude; if(map){ map.setView([userLat, userLng], 14); userMarker.setLatLng([userLat, userLng]); } fetchNearbyShops(); },
      () => { fetchNearbyShops(); }
    );
  }
}

async function fetchNearbyShops() {
  const res = await fetch(`/api/shops/nearby?lat=${userLat}&lng=${userLng}`);
  allShops = await res.json();
  const container = document.getElementById('shop-list'); container.innerHTML = '';
  Object.values(shopMarkers).forEach(m => map.removeLayer(m)); shopMarkers = {};

  allShops.forEach(shop => {
    const marker = L.marker([shop.location.coordinates[1], shop.location.coordinates[0]], {icon: blueIcon}).addTo(map).bindPopup(`<b>${shop.shopName}</b>`);
    marker.on('click', () => openProfile(shop._id)); shopMarkers[shop._id] = marker;
    
    let badge = shop.isOpenToday ? `<span class="bg-green-500/20 text-green-400 px-2 py-0.5 rounded text-[10px] font-bold">OPEN</span>` : `<span class="bg-red-500/20 text-red-400 px-2 py-0.5 rounded text-[10px] font-bold">CLOSED</span>`;
    
    container.innerHTML += `
      <div class="bg-slate-800 p-4 rounded-xl border border-slate-700 cursor-pointer hover:border-amber-500 transition flex space-x-3" onclick="openProfile('${shop._id}')">
        <img src="${shop.photos[0] || ''}" class="w-20 h-20 rounded-lg object-cover">
        <div class="flex-1">
          <div class="flex justify-between items-start"><h3 class="font-bold text-amber-400">${shop.shopName}</h3>${badge}</div>
          <p class="text-xs text-slate-400">📍 ${shop.distanceKm} km away</p>
        </div>
      </div>`;
  });
}

function openProfile(shopId) {
  selectedShop = allShops.find(s => s._id === shopId);
  Object.keys(shopMarkers).forEach(id => shopMarkers[id].setIcon(id === shopId ? redIcon : blueIcon));
  map.setView([selectedShop.location.coordinates[1], selectedShop.location.coordinates[0]], 15);

  document.getElementById('prof-name').innerText = selectedShop.shopName;
  document.getElementById('prof-address').innerText = "📍 " + selectedShop.address;
  
  if(selectedShop.isOpenToday) { document.getElementById('closed-overlay').classList.replace('flex','hidden'); } 
  else { document.getElementById('closed-overlay').classList.replace('hidden','flex'); }

  const gal = document.getElementById('prof-gallery'); gal.innerHTML = '';
  selectedShop.photos.forEach(src => gal.innerHTML += `<img src="${src}" onclick="openLightbox('${src}')" class="w-32 h-32 rounded-lg object-cover snap-center cursor-pointer border border-slate-600">`);

  const sList = document.getElementById('prof-services'); sList.innerHTML = '';
  selectedShop.services.forEach((s, idx) => {
      sList.innerHTML += `
        <label class="flex items-center justify-between p-2 hover:bg-blue-50 rounded cursor-pointer border-b border-slate-100 last:border-0">
          <div class="flex space-x-2 items-center"><input type="radio" name="service" value="${idx}" onchange="selectedService = selectedShop.services[${idx}]; checkBookingBtn();" class="accent-blue-600 w-4 h-4">
          <div><p class="text-sm font-bold text-slate-800">${s.name}</p></div></div>
          <span class="text-sm font-bold text-blue-700">₹${s.price}</span>
        </label>`;
  });

  // Init Date Picker (Set min to today)
  const dateInput = document.getElementById('book-date');
  const today = new Date().toLocaleDateString('en-CA'); // 'YYYY-MM-DD' formatting in local timezone
  dateInput.min = today;
  dateInput.value = today;
  loadSlots(); // Load slots for today immediately

  if(ownerPhone === selectedShop.phone) document.getElementById('owner-actions').classList.remove('hidden');
  else document.getElementById('owner-actions').classList.add('hidden');

  document.getElementById('profile-modal').classList.remove('hidden'); document.getElementById('profile-modal').classList.add('flex');
}

function closeProfile() {
  document.getElementById('profile-modal').classList.replace('flex', 'hidden');
  selectedSlotTime = null; selectedService = null;
  if(selectedShop && shopMarkers[selectedShop._id]) shopMarkers[selectedShop._id].setIcon(blueIcon);
}

function openLightbox(src) { document.getElementById('lightbox-img').src = src; document.getElementById('lightbox-modal').classList.replace('hidden', 'flex'); }
function closeLightbox() { document.getElementById('lightbox-modal').classList.replace('flex', 'hidden'); }

// ==========================================
// UIDAI SLOT LOGIC
// ==========================================
async function loadSlots() {
    const date = document.getElementById('book-date').value;
    if(!date) return;
    
    selectedSlotTime = null; checkBookingBtn();
    
    const res = await fetch(`/api/shops/${selectedShop._id}/slots?date=${date}`);
    const data = await res.json();
    
    const grid = document.getElementById('slot-grid');
    grid.innerHTML = '';
    
    let totalCap = 0, availCap = 0;

    data.slots.forEach(slot => {
        totalCap += slot.total; availCap += slot.available;
        
        let isFull = slot.available === 0;
        let btnClass = isFull ? 'bg-slate-200 text-slate-400 border-slate-300 cursor-not-allowed' 
                              : 'bg-white text-slate-800 border-slate-400 hover:border-blue-600 cursor-pointer';
        
        grid.innerHTML += `
          <div id="slot-btn-${slot.time.replace(/\s/g,'')}" class="uidai-slot border rounded-md p-1.5 text-center flex flex-col items-center justify-center ${btnClass}"
               onclick="${isFull ? '' : `selectSlot('${slot.time}')`}">
             <p class="text-[11px] font-bold">${slot.time}</p>
             <p class="text-[9px] ${isFull ? 'text-red-500' : 'text-green-600'} font-bold">Available: ${slot.available}</p>
          </div>
        `;
    });
    
    document.getElementById('slot-total-tokens').innerText = totalCap;
    document.getElementById('slot-avail-tokens').innerText = availCap;

    // Load Owner Dashboard Data
    if(ownerPhone === selectedShop.phone) {
        document.getElementById('owner-dashboard').classList.remove('hidden');
        const dashList = document.getElementById('owner-bookings-list');
        dashList.innerHTML = '';
        if(data.bookings.length === 0) dashList.innerHTML = '<p class="text-xs text-slate-400">No bookings for this date.</p>';
        data.bookings.forEach(b => {
            dashList.innerHTML += `
              <div class="bg-slate-700 p-2 rounded flex justify-between text-xs border border-slate-600">
                 <div><p class="font-bold text-amber-400">${b.tokenNumber}</p><p class="text-white">${b.timeSlot}</p></div>
                 <div class="text-right"><p class="text-slate-300">${b.customerName}</p><p class="text-slate-400">${b.customerPhone}</p></div>
              </div>`;
        });
    } else {
        document.getElementById('owner-dashboard').classList.add('hidden');
    }
}

function selectSlot(time) {
    // Deselect old
    if(selectedSlotTime) document.getElementById(`slot-btn-${selectedSlotTime.replace(/\s/g,'')}`).classList.remove('selected');
    // Select new
    selectedSlotTime = time;
    document.getElementById(`slot-btn-${selectedSlotTime.replace(/\s/g,'')}`).classList.add('selected');
    checkBookingBtn();
}

function checkBookingBtn() {
    const btn = document.getElementById('book-btn');
    if(selectedSlotTime && selectedService) btn.disabled = false;
    else btn.disabled = true;
}

// Validation for Max 1MB per photo
function validateFiles(input) {
    if(input.files.length > 5) { alert("Maximum 5 photos allowed!"); input.value = ''; return; }
    for(let file of input.files) {
        if(file.size > 1024 * 1024) { alert(`File ${file.name} is larger than 1MB! Please select smaller photos.`); input.value = ''; return; }
    }
}

// ==========================================
// FORM & OWNER LOGIC
// ==========================================
function loginAsOwner() {
    const p = prompt("Enter your registered Shop Mobile Number:");
    if(p) { localStorage.setItem('barberq_owner_phone', p); ownerPhone = p; alert("Owner mode activated!"); location.reload(); }
}

function openFormModal(mode) {
    document.getElementById('form-modal').classList.replace('hidden', 'flex');
    document.getElementById('dynamic-services').innerHTML = ''; 
    if(mode === 'register') {
        document.getElementById('form-shopId').value = "";
        ['reg-name', 'reg-owner', 'reg-phone', 'reg-address', 'reg-lat', 'reg-lng'].forEach(id => document.getElementById(id).value = "");
        document.getElementById('reg-open').value = "09:00"; document.getElementById('reg-close').value = "21:00";
        document.getElementById('reg-dur').value = "30"; document.getElementById('reg-chair').value = "1";
        document.getElementById('status-toggle-container').classList.add('hidden'); addServiceRow();
    } else {
        document.getElementById('form-title').innerText = "Edit Settings";
        document.getElementById('form-shopId').value = selectedShop._id;
        document.getElementById('reg-name').value = selectedShop.shopName; document.getElementById('reg-owner').value = selectedShop.ownerName;
        document.getElementById('reg-phone').value = selectedShop.phone; document.getElementById('reg-address').value = selectedShop.address;
        document.getElementById('reg-lat').value = selectedShop.location.coordinates[1]; document.getElementById('reg-lng').value = selectedShop.location.coordinates[0];
        document.getElementById('reg-open').value = selectedShop.openingTime; document.getElementById('reg-close').value = selectedShop.closingTime;
        document.getElementById('reg-dur').value = selectedShop.slotDuration; document.getElementById('reg-chair').value = selectedShop.chairs;
        document.getElementById('status-toggle-container').classList.replace('hidden', 'flex');
        document.getElementById('reg-status').checked = selectedShop.isOpenToday;
        selectedShop.services.forEach(s => addServiceRow(s.name, s.price, s.duration));
    }
}
function closeFormModal() { document.getElementById('form-modal').classList.replace('flex', 'hidden'); }
function addServiceRow(n='', p='', d='') {
    const row = document.createElement('div'); row.className = "flex space-x-2 service-row";
    row.innerHTML = `<input type="text" value="${n}" placeholder="Service" class="s-name w-1/2 bg-slate-800 p-2 rounded text-xs text-white border border-slate-600"><input type="number" value="${p}" placeholder="₹" class="s-price w-1/4 bg-slate-800 p-2 rounded text-xs text-white border border-slate-600">`;
    document.getElementById('dynamic-services').appendChild(row);
}
function getCurrentLocationForReg() { navigator.geolocation.getCurrentPosition((pos) => { document.getElementById('reg-lat').value = pos.coords.latitude; document.getElementById('reg-lng').value = pos.coords.longitude; }); }

async function submitForm() {
  const shopId = document.getElementById('form-shopId').value, isEdit = shopId !== "";
  const formData = new FormData();
  
  formData.append('name', document.getElementById('reg-name').value); formData.append('ownerName', document.getElementById('reg-owner').value);
  formData.append('phone', document.getElementById('reg-phone').value); formData.append('address', document.getElementById('reg-address').value);
  formData.append('lat', document.getElementById('reg-lat').value); formData.append('lng', document.getElementById('reg-lng').value);
  formData.append('openingTime', document.getElementById('reg-open').value); formData.append('closingTime', document.getElementById('reg-close').value);
  formData.append('slotDuration', document.getElementById('reg-dur').value); formData.append('chairs', document.getElementById('reg-chair').value);
  if(isEdit) formData.append('isOpenToday', document.getElementById('reg-status').checked);

  const sArr = [];
  document.querySelectorAll('.service-row').forEach(row => {
      const n = row.querySelector('.s-name').value, p = row.querySelector('.s-price').value;
      if(n && p) sArr.push({ name: n, price: parseInt(p), duration: 0 }); // duration handled by slot now
  });
  formData.append('services', JSON.stringify(sArr));
  
  const photoInput = document.getElementById('reg-photos');
  for(let i = 0; i < photoInput.files.length; i++) { if(i < 5) formData.append('photos', photoInput.files[i]); }

  const btn = document.getElementById('submit-btn');
  try {
      btn.innerText = "Processing... Please wait"; btn.disabled = true;
      const res = await fetch(isEdit ? `/api/shops/${shopId}` : `/api/shops/register`, { method: isEdit ? 'PUT' : 'POST', body: formData });
      const data = await res.json();
      if(data.success) { alert(isEdit ? "Profile Updated! Old photos deleted." : "Salon Live!"); closeFormModal(); if(isEdit) closeProfile(); fetchNearbyShops(); } 
      else { alert("Error: " + data.error); }
  } catch (err) { alert("Action failed!"); } 
  finally { btn.innerText = "Save Profile"; btn.disabled = false; }
}

// Booking System
function confirmBooking() {
  const name = document.getElementById('cust-name').value, phone = document.getElementById('cust-phone').value;
  const date = document.getElementById('book-date').value;
  if (!name || !phone || !selectedService || !selectedSlotTime) return alert('Kripya saari details bharein!');
  
  document.getElementById('book-btn').innerText = "Booking...";
  socket.emit('book_appointment', { shopId: selectedShop._id, customerName: name, customerPhone: phone, serviceName: selectedService.name, bookingDate: date, timeSlot: selectedSlotTime });
}

socket.on('booking_confirmed', (data) => {
  document.getElementById('book-btn').innerText = "Confirm Appointment";
  document.getElementById('display-token').innerText = data.tokenNumber;
  document.getElementById('display-time').innerText = data.appointmentTime;
  document.getElementById('token-modal').classList.replace('hidden', 'flex');
  loadSlots(); // Refresh slots grid live
});

// Refresh slot grid live for everyone if someone else books
socket.on('slot_booked', ({ shopId, bookingDate }) => {
   if (selectedShop && selectedShop._id === shopId && document.getElementById('book-date').value === bookingDate) {
       loadSlots();
   }
});

window.onload = () => { initMap(); getUserLocation(); };