// --- 1. PROMOTER / AFFILIATE TRACKING ---
function capturePromoterCode() {
  const urlParams = new URLSearchParams(window.location.search);
  const promoter = urlParams.get('ref') || urlParams.get('promoter');

  if (promoter) {
    sessionStorage.setItem('promoterCode', promoter.toUpperCase());
  }

  const savedCode = sessionStorage.getItem('promoterCode');
  
  const promoterInput = document.getElementById('promoterCode');
  const promoterDisplay = document.getElementById('promoter-display');
  const promoterBadge = document.getElementById('promoter-badge');

  if (savedCode && promoterInput) {
    promoterInput.value = savedCode;
    
    if (promoterDisplay) {
      promoterDisplay.textContent = savedCode;
    }
    if (promoterBadge) {
      promoterBadge.classList.remove('hidden');
    }
  }
}

capturePromoterCode();
document.addEventListener('DOMContentLoaded', capturePromoterCode);

// --- 2. MULTI-PAGE NAVIGATION LOGIC ---
function nextPage(currentPage) {
  const currentSection = document.getElementById(`page-${currentPage}`);
  const inputs = currentSection.querySelectorAll('input, select, textarea');
  
  let isValid = true;
  for (const input of inputs) {
    if (!input.checkValidity()) {
      input.reportValidity();
      isValid = false;
      break;
    }
  }

  if (!isValid) return;

  document.getElementById(`page-${currentPage}`).classList.add('hidden');
  document.getElementById(`page-${currentPage + 1}`).classList.remove('hidden');

  const currentIndicator = document.getElementById(`indicator-${currentPage}`);
  const nextIndicator = document.getElementById(`indicator-${currentPage + 1}`);
  if (currentIndicator) currentIndicator.classList.remove('active');
  if (nextIndicator) nextIndicator.classList.add('active');

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function prevPage(currentPage) {
  document.getElementById(`page-${currentPage}`).classList.add('hidden');
  document.getElementById(`page-${currentPage - 1}`).classList.remove('hidden');

  const currentIndicator = document.getElementById(`indicator-${currentPage}`);
  const prevIndicator = document.getElementById(`indicator-${currentPage - 1}`);
  if (currentIndicator) currentIndicator.classList.remove('active');
  if (prevIndicator) prevIndicator.classList.add('active');

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// --- 3. INPUT HELPER FUNCTIONS ---
function getCheckedValues(name) {
  const checkboxes = document.querySelectorAll(`input[name="${name}"]:checked`);
  let values = Array.from(checkboxes).map(cb => cb.value);
  return values.length > 0 ? values.join(', ') : 'None selected';
}

function getRadioValue(name, otherInputId = null) {
  const selected = document.querySelector(`input[name="${name}"]:checked`);
  if (!selected) return 'Not specified';

  if (selected.value === 'Other' && otherInputId) {
    const customText = document.getElementById(otherInputId)?.value.trim();
    if (customText) {
      return `Other: ${customText}`;
    }
  }
  return selected.value;
}

function escapeHTML(str) {
  return String(str).replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

// --- 4. REVIEW MODAL & POST-SUBMISSION LOGIC ---
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('contact-form');
  const submitBtn = document.getElementById('submit-btn');
  const confirmModal = document.getElementById('confirmModal');
  const postSubmitModal = document.getElementById('postSubmitModal');
  const summaryList = document.getElementById('summaryList');
  const editBtn = document.getElementById('editBtn');
  const finalSubmitBtn = document.getElementById('finalSubmitBtn');
  const statusMsg = document.getElementById('status-message');

  const btnSubmitAnotherYes = document.getElementById('submitAnotherYes');
  const btnSubmitAnotherNo = document.getElementById('submitAnotherNo');

  // Trigger Confirmation Review Modal
  if (submitBtn) {
    submitBtn.addEventListener('click', (e) => {
      e.preventDefault();

      const page3 = document.getElementById('page-3');
      const inputs = page3.querySelectorAll('input, select, textarea');
      
      for (const input of inputs) {
        if (!input.checkValidity()) {
          input.reportValidity();
          return;
        }
      }

      summaryList.innerHTML = '';

      const summaryData = [
        { label: 'Referral Code', value: sessionStorage.getItem('promoterCode') || document.getElementById('promoterCode')?.value || 'Direct (No Referral)' },
        { label: 'Full Name', value: document.getElementById('name').value },
        { label: 'Email', value: document.getElementById('email').value },
        { label: 'Phone', value: `${document.getElementById('country-code').value} ${document.getElementById('phone').value}` },
        { label: 'Service Address', value: document.getElementById('address').value },
        { label: 'Service Tier', value: getRadioValue('serviceTier') },
        { label: 'Property Status', value: getRadioValue('propertyStatus', 'propertyStatusOther') },
        { label: 'Cabinet Cleaning', value: getRadioValue('insideCabinets', 'cabinetsOther') },
        { label: 'Property Size', value: document.getElementById('propertySize').value },
        { label: 'Focus Areas', value: getCheckedValues('focusAreas') },
        { label: 'Delicate Surfaces', value: getCheckedValues('delicateSurfaces') },
        { label: 'Entry Method', value: getRadioValue('entryMethod', 'entryOther') },
        { label: 'Add-Ons', value: getCheckedValues('addOns') },
        { label: 'Preferred Date', value: document.getElementById('cleaningDate').value },
        { label: 'Time Slot', value: getRadioValue('timeSlot') },
        { label: 'Special Instructions', value: document.getElementById('specialInstructions').value },
        { label: 'Lead Source', value: getRadioValue('leadSource', 'leadSourceOther') }
      ];

      summaryData.forEach(item => {
        if (!item.value || item.value === 'None selected' || item.value === 'Not specified') return;

        const li = document.createElement('li');
        li.innerHTML = `<strong>${item.label}:</strong> ${escapeHTML(item.value)}`;
        summaryList.appendChild(li);
      });

      if (confirmModal) confirmModal.style.display = 'flex';
    });
  }

  // Edit Button in Review Modal
  if (editBtn) {
    editBtn.addEventListener('click', () => {
      if (confirmModal) confirmModal.style.display = 'none';
    });
  }

  // Submit to Server API
  if (finalSubmitBtn) {
    finalSubmitBtn.addEventListener('click', async () => {
      if (confirmModal) confirmModal.style.display = 'none';

      const honeypot = document.getElementById('website_hp')?.value;
      if (honeypot) {
        console.warn('Spam submission detected.');
        return;
      }

      finalSubmitBtn.disabled = true;
      if (statusMsg) {
        statusMsg.textContent = 'Submitting inquiry...';
        statusMsg.className = 'status';
      }

      const payload = {
        business_slug: document.getElementById('businessSlug')?.value || 'cleaning',
        promoterCode: sessionStorage.getItem('promoterCode') || document.getElementById('promoterCode')?.value || 'Direct (No Referral)',
        name: document.getElementById('name').value,
        email: document.getElementById('email').value,
        phone: `${document.getElementById('country-code').value} ${document.getElementById('phone').value}`,
        address: document.getElementById('address').value,
        serviceTier: getRadioValue('serviceTier'),
        propertyStatus: getRadioValue('propertyStatus', 'propertyStatusOther'),
        insideCabinets: getRadioValue('insideCabinets', 'cabinetsOther'),
        propertySize: document.getElementById('propertySize').value,
        focusAreas: getCheckedValues('focusAreas'),
        delicateSurfaces: getCheckedValues('delicateSurfaces'),
        entryMethod: getRadioValue('entryMethod', 'entryOther'),
        addOns: getCheckedValues('addOns'),
        cleaningDate: document.getElementById('cleaningDate').value,
        timeSlot: getRadioValue('timeSlot'),
        specialInstructions: document.getElementById('specialInstructions').value,
        leadSource: getRadioValue('leadSource', 'leadSourceOther'),
        website_hp: honeypot || ''
      };

      try {
        const res = await fetch('/api/public/inquiry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await res.json();

        if (res.ok) {
          form.reset();

          // Reset step navigation indicators to Page 1
          document.getElementById('page-3')?.classList.add('hidden');
          document.getElementById('page-1')?.classList.remove('hidden');

          const ind3 = document.getElementById('indicator-3');
          const ind1 = document.getElementById('indicator-1');
          if (ind3) ind3.classList.remove('active');
          if (ind1) ind1.classList.add('active');

          // Display the "Submit another form?" popup modal
          if (postSubmitModal) {
            postSubmitModal.style.display = 'flex';
          }
        } else {
          throw new Error(data.error || data.message || 'Submission failed.');
        }
      } catch (err) {
        if (statusMsg) {
          statusMsg.textContent = err.message;
          statusMsg.className = 'status error';
        }
      } finally {
        finalSubmitBtn.disabled = false;
      }
    });
  }

  // --- POST-SUBMISSION MODAL BUTTON HANDLERS ---
  
  // Option YES: Hide popup and allow them to fill out a fresh form
  if (btnSubmitAnotherYes) {
    btnSubmitAnotherYes.addEventListener('click', () => {
      if (postSubmitModal) postSubmitModal.style.display = 'none';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // Option NO: Close popup, wipe out form content, and center Thank You message
  if (btnSubmitAnotherNo) {
    btnSubmitAnotherNo.addEventListener('click', () => {
      if (postSubmitModal) postSubmitModal.style.display = 'none';

      const mainContainer = document.querySelector('main') || document.body;
      
      // Remove header nav indicators and form elements
      mainContainer.innerHTML = `
        <div style="
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 60vh;
          text-align: center;
          padding: 2rem;
        ">
          <h1 style="font-size: 2.25rem; color: #1e3a8a; margin-bottom: 1rem;">Thank You!</h1>
          <p style="font-size: 1.25rem; color: #4b5563; max-width: 600px; line-height: 1.6;">
            Your inquiry has been submitted successfully, and we have received your request and will reach out to you shortly, so please check your emails regularly.
          </p>
        </div>
      `;
      
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }
});