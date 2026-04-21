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

  // ---------- email capture form ----------
  document.querySelectorAll('[data-email-form]').forEach(form => {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = form.querySelector('input[type="email"]');
      const submit = form.querySelector('button[type="submit"]');
      const success = form.querySelector('[data-email-success]');
      if (!input.value.trim()) return;
      submit.disabled = true;
      submit.textContent = 'Saving…';
      // No backend — just show the confirmation state.
      setTimeout(() => {
        form.querySelector('[data-email-fields]').style.display = 'none';
        if (success) success.style.display = 'flex';
      }, 600);
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
