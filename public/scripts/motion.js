/* =========================================================
   Attic marketing — motion + interactions
   Vanilla JS. No dependencies. Respects prefers-reduced-motion.
   ========================================================= */

(() => {
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- nav scrolled state ----------
  const nav = document.querySelector('.nav');
  if (nav) {
    const onScroll = () => nav.classList.toggle('is-scrolled', window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  // ---------- sticky mobile CTA ----------
  // Slides up once the hero has scrolled out of view, and hides again when
  // the waitlist form is on screen so it never shadows the live form.
  const mobileCta = document.querySelector('[data-mobile-cta]');
  if (mobileCta) {
    const hero = document.querySelector('.hero');
    const waitlist = document.querySelector('#waitlist');
    const update = () => {
      const pastHero = hero
        ? hero.getBoundingClientRect().bottom < 0
        : window.scrollY > 400;
      const waitlistVisible = waitlist
        ? waitlist.getBoundingClientRect().top < window.innerHeight
        : false;
      mobileCta.classList.toggle('is-visible', pastHero && !waitlistVisible);
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update, { passive: true });
  }

  // ---------- reveal on scroll ----------
  if (!prefersReduced && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('is-in');
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    document.querySelectorAll('.reveal').forEach(el => io.observe(el));
  } else {
    document.querySelectorAll('.reveal').forEach(el => el.classList.add('is-in'));
  }

  // ---------- hero phone parallax + cycle ----------
  const phoneStack = document.querySelector('[data-phone-stack]');
  if (phoneStack && !prefersReduced) {
    const cards = [...phoneStack.querySelectorAll('[data-phone-card]')];
    let active = 0;
    const cycle = () => {
      cards.forEach((c, i) => c.classList.toggle('is-active', i === active));
      active = (active + 1) % cards.length;
    };
    cycle();
    setInterval(cycle, 3200);
  }

  // ---------- counter animation ----------
  const counters = document.querySelectorAll('[data-count]');
  if (counters.length && !prefersReduced && 'IntersectionObserver' in window) {
    const cio = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        const target = parseFloat(el.dataset.count);
        const decimals = parseInt(el.dataset.decimals || '0', 10);
        const prefix = el.dataset.prefix || '';
        const suffix = el.dataset.suffix || '';
        const dur = 1400;
        const start = performance.now();
        const tick = (now) => {
          const t = Math.min(1, (now - start) / dur);
          const eased = 1 - Math.pow(1 - t, 3);
          const v = target * eased;
          el.textContent = prefix + v.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + suffix;
          if (t < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        cio.unobserve(el);
      });
    }, { threshold: 0.4 });
    counters.forEach(c => cio.observe(c));
  } else {
    counters.forEach(c => {
      const target = parseFloat(c.dataset.count);
      const decimals = parseInt(c.dataset.decimals || '0', 10);
      const prefix = c.dataset.prefix || '';
      const suffix = c.dataset.suffix || '';
      c.textContent = prefix + target.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + suffix;
    });
  }

  // ---------- waitlist form ----------
  // Posts { email, zip, _h } to /api/waitlist (Vercel edge function).
  // The function writes the Harper WaitlistSignup row + upserts a Klaviyo
  // profile. The double-opt-in email goes out from Klaviyo; the success
  // state we show here is "we sent you a confirm link," not "you're done."
  document.querySelectorAll('[data-email-form]').forEach(form => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const emailInput = form.querySelector('input[type="email"]');
      const zipInput = form.querySelector('input[name="zip"]');
      const honeypot = form.querySelector('input[name="_h"]');
      const submit = form.querySelector('button[type="submit"]');
      const success = form.querySelector('[data-email-success]');
      const errorBox = form.querySelector('[data-email-error]');
      const fields = form.querySelector('[data-email-fields]');

      const email = (emailInput?.value || '').trim();
      const zip = (zipInput?.value || '').trim();

      function showError(msg) {
        if (!errorBox) return;
        errorBox.textContent = msg;
        errorBox.classList.add('is-visible');
      }
      function clearError() {
        if (!errorBox) return;
        errorBox.textContent = '';
        errorBox.classList.remove('is-visible');
      }

      clearError();

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showError('Please enter a valid email address.');
        emailInput?.focus();
        return;
      }
      if (!/^\d{5}$/.test(zip)) {
        showError('ZIP code should be 5 digits.');
        zipInput?.focus();
        return;
      }

      const originalLabel = submit.textContent;
      submit.disabled = true;
      submit.textContent = 'Saving…';

      try {
        const res = await fetch('/api/waitlist', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            email,
            zip,
            _h: honeypot?.value || '',
            // record which domain the signup actually came through
            // (site serves on heyattic.com and, pre-redirect, attic.it.com)
            source: window.location.hostname,
          }),
        });

        if (!res.ok) {
          let msg = 'Something went wrong — please try again.';
          try {
            const body = await res.json();
            if (body?.error === 'invalid_email') msg = 'That email doesn\'t look right.';
            else if (body?.error === 'invalid_zip') msg = 'ZIP code should be 5 digits.';
          } catch { /* fall through to default */ }
          showError(msg);
          submit.disabled = false;
          submit.textContent = originalLabel;
          return;
        }

        const body = await res.json().catch(() => ({}));
        if (fields) fields.style.display = 'none';
        if (success) {
          if (body.already_confirmed) {
            const span = success.querySelector('span');
            if (span) span.textContent = "You're already on the list — we'll be in touch as Denver opens up.";
          }
          success.style.display = 'flex';
        }
      } catch (err) {
        showError('Network hiccup — please try again.');
        submit.disabled = false;
        submit.textContent = originalLabel;
      }
    });
  });

  // ---------- hero ticker ----------
  const ticker = document.querySelector('[data-ticker]');
  if (ticker && !prefersReduced) {
    const lines = [...ticker.querySelectorAll('[data-ticker-line]')];
    if (lines.length > 1) {
      let i = 0;
      setInterval(() => {
        lines[i].classList.remove('is-active');
        i = (i + 1) % lines.length;
        lines[i].classList.add('is-active');
      }, 2800);
      lines[0].classList.add('is-active');
    }
  }

  // ---------- hero dust motes ----------
  const dust = document.querySelector('[data-dust]');
  if (dust && !prefersReduced) {
    const N = 18;
    for (let k = 0; k < N; k++) {
      const m = document.createElement('span');
      m.className = 'hero-dust__mote';
      m.style.left = Math.random() * 100 + '%';
      m.style.animationDuration = (14 + Math.random() * 14) + 's';
      m.style.animationDelay = -Math.random() * 20 + 's';
      m.style.setProperty('--drift', (Math.random() * 60 - 30) + 'px');
      m.style.width = m.style.height = (2 + Math.random() * 3) + 'px';
      m.style.opacity = (0.3 + Math.random() * 0.5);
      dust.appendChild(m);
    }
  }
})();
