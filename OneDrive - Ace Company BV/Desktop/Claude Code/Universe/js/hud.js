/* hud.js -- HUD update module: nearest body detection, distance, speed, info cards */

import { AU } from './constants.js';
import { getAltitude } from './altitude.js';
import { getPlanetConfig } from './planetconfig.js';
import { getApproachInfo } from './flight.js';

let speedEl, tNameEl, tDistEl, angEl, infoPanel, infoPanelDesc;
let infoCard, infoCardName, infoCardType, infoCardFacts, infoCardLore, infoCardLine;

export function initHud() {
  speedEl       = document.getElementById('speed-val');
  tNameEl       = document.getElementById('target-name');
  tDistEl       = document.getElementById('target-dist');
  angEl         = document.getElementById('ang-size');
  infoPanel     = document.getElementById('info-panel');
  infoPanelDesc = infoPanel ? infoPanel.querySelector('.desc') : null;
  infoCard      = document.getElementById('info-card');
  infoCardName  = document.getElementById('info-card-name');
  infoCardType  = document.getElementById('info-card-type');
  infoCardFacts = document.getElementById('info-card-facts');
  infoCardLore  = document.getElementById('info-card-lore');
  infoCardLine  = document.getElementById('info-card-line');
}

/**
 * @param {THREE.Vector3} camPos  - player position
 * @param {number}         speed  - current velocity magnitude
 * @param {Array<{name:string, desc:string, g:Object3D, r:number}>} allBodies
 */
export function updateHud(camPos, speed, allBodies) {
  /* 1. Speed — show in meaningful units --------------------------------- */
  if (speedEl) {
    // Convert scene units/s to approximate km/s (1 AU = 3000 units = 150M km)
    const kmPerUnit = 150000000 / AU;  // ~50,000 km per unit
    const kmPerSec = speed * kmPerUnit * 60;  // velocity is scaled by 60 in flight.js
    const unitEl = document.getElementById('speed-unit');

    if (kmPerSec > 500000) {
      // Show as fraction of light speed
      const c = kmPerSec / 299792;
      speedEl.textContent = c.toFixed(2);
      if (unitEl) unitEl.textContent = 'c';
    } else if (kmPerSec > 1000) {
      speedEl.textContent = (kmPerSec / 1000).toFixed(1);
      if (unitEl) unitEl.textContent = 'K KM/S';
    } else if (kmPerSec > 1) {
      speedEl.textContent = kmPerSec.toFixed(0);
      if (unitEl) unitEl.textContent = 'KM/S';
    } else {
      speedEl.textContent = (kmPerSec * 1000).toFixed(0);
      if (unitEl) unitEl.textContent = 'M/S';
    }
  }

  /* 2. Find nearest body ------------------------------------------------ */
  let nb   = null;
  let dist = Infinity;

  for (let i = 0; i < allBodies.length; i++) {
    const b = allBodies[i];
    const bPos = b.g.userData._worldPos || b.g.position;
    const d = camPos.distanceTo(bPos) - b.r;
    if (d < dist) { dist = d; nb = b; }
  }

  if (!nb) return;

  /* 3. Target name, distance, angular size ------------------------------ */
  if (tNameEl) tNameEl.textContent = nb.name;

  const auDist = Math.max(0, dist) / AU;
  const km     = auDist * 1.496e8;

  if (tDistEl) {
    tDistEl.textContent =
      auDist.toFixed(3) + ' AU \u00b7 ' + formatKm(km) + ' km';
  }

  if (angEl) {
    const rawDist = camPos.distanceTo(nb.g.userData._worldPos || nb.g.position);
    const ang     = 2 * Math.atan(nb.r / Math.max(nb.r + 0.001, rawDist))
                      * (180 / Math.PI);
    angEl.textContent = '\u2205 ' + ang.toFixed(3) + '\u00b0';
  }

  /* 4. Rich info card — fades in as you approach ----------------------- */
  const approach = getApproachInfo();
  const config = getPlanetConfig(nb.name);

  if (infoCard && config && config.info) {
    const ang = approach.angularSize;

    if (ang > 2) {
      infoCard.style.display = 'block';
      // Slow cinematic fade-in over a wide angular range
      const fadeT = Math.min(1, (ang - 2) / 8);
      infoCard.style.opacity = fadeT;

      // Name appears first — large and dramatic
      if (infoCardName) infoCardName.textContent = nb.name;

      // Type appears next
      if (infoCardType) {
        infoCardType.textContent = config.info.type || '';
        infoCardType.style.opacity = ang > 3 ? Math.min(1, (ang - 3) / 3) : 0;
      }

      // Divider line
      if (infoCardLine) {
        infoCardLine.style.opacity = ang > 4 ? Math.min(1, (ang - 4) / 2) : 0;
      }

      // Facts reveal one at a time
      if (infoCardFacts) {
        const facts = config.info.facts || [];
        infoCardFacts.innerHTML = '';
        const visibleFacts = ang > 5 ? Math.min(facts.length, Math.floor((ang - 5) / 2) + 1) : 0;
        for (let i = 0; i < visibleFacts; i++) {
          const li = document.createElement('div');
          li.textContent = facts[i];
          infoCardFacts.appendChild(li);
        }
        infoCardFacts.style.opacity = visibleFacts > 0 ? 1 : 0;
      }

      // Lore appears last — the emotional payoff
      if (infoCardLore) {
        infoCardLore.textContent = config.info.lore || '';
        infoCardLore.style.opacity = ang > 10 ? Math.min(1, (ang - 10) / 5) : 0;
      }
    } else {
      infoCard.style.opacity = 0;
      if (ang < 1) infoCard.style.display = 'none';
    }
  } else if (infoCard) {
    infoCard.style.display = 'none';
  }

  /* 5. Legacy info panel (short desc) ---------------------------------- */
  if (infoPanel) {
    // Hide legacy panel when info card is showing
    if (infoCard && infoCard.style.display === 'block' && parseFloat(infoCard.style.opacity) > 0.1) {
      infoPanel.style.display = 'none';
    } else if (dist < nb.r * 10 && nb.desc) {
      if (infoPanelDesc) infoPanelDesc.textContent = nb.desc;
      infoPanel.style.display = 'block';
    } else {
      infoPanel.style.display = 'none';
    }
  }
}

/* --- helpers ----------------------------------------------------------- */

function formatKm(n) {
  const s   = Math.round(n).toString();
  const len = s.length;
  let out   = '';
  for (let i = 0; i < len; i++) {
    if (i > 0 && (len - i) % 3 === 0) out += ',';
    out += s[i];
  }
  return out;
}
