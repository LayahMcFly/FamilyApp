/* Family Hub: the central screen people land on after signing in.
 * It only links to things that already exist. Planned areas are labelled "Planned" and do not navigate. It does not read or write any family data of its own,
 * and it grants no permissions: every destination checks access exactly as before.
 * Installed by app.js with FCHub.install({ S, VIEWS, CFG, h, icon, famName, familySwitcher, shopEnabled }). */
(function () {
  'use strict';
  var RECIPES_URL = 'https://layahmcfly.github.io/ZenfulOutput/recipe-book/';
  var BOARD_URL = 'https://layahmcfly.github.io/ZenfulOutput/family-board/';
  var ORIGINAL_NOTE = 'Original app — separate sign-in may be required.';

  function install(X) {
    var h = X.h, icon = X.icon;

    // One destination card. Inside links stay in this tab; "original" links open the old website in a new tab.
    function card(o) {
      var kids = [
        h('span', { class: 'hub-ic', 'aria-hidden': 'true' }, icon(o.icon)),
        h('span', { class: 'hub-text' },
          h('strong', { class: 'hub-title', text: o.title }),
          h('span', { class: 'hub-desc', text: o.desc }),
          o.external ? h('span', { class: 'hub-orig', text: ORIGINAL_NOTE }) : null)
      ];
      if (o.external) kids.push(h('span', { class: 'hub-ext', 'aria-hidden': 'true' }, icon('external')));
      var attrs = { class: 'hub-card' + (o.external ? ' hub-original' : ''), href: o.href, 'data-hub': o.id };
      if (o.external) {
        attrs.target = '_blank'; attrs.rel = 'noopener noreferrer';
        attrs['aria-label'] = o.title + '. ' + o.desc + ' ' + ORIGINAL_NOTE + ' Opens in a new tab.';
      }
      return h('li', null, h('a', attrs, kids));
    }

    // A destination that is on the roadmap but not built. It is a button, not a link: nothing here navigates, and it holds no
    // data, form, payment, upload or enrolment control. Activating it only shows or hides a short "not available yet" note.
    function plannedCard(o) {
      var noteId = 'hub-note-' + o.id, ico = h('span', { class: 'hub-ic', 'aria-hidden': 'true' }, icon(o.icon));
      var note = h('p', { class: 'hub-note', id: noteId, text: o.name + ' is not available yet. It is planned for a future release, and there is nothing to open, create, send or pay here today.' });
      note.hidden = true;
      var btn = h('button', { type: 'button', class: 'hub-card hub-planned', 'data-hub': o.id, 'aria-expanded': 'false', 'aria-controls': noteId },
        [ico, h('span', { class: 'hub-text' },
          h('strong', { class: 'hub-title', text: o.name }),
          h('span', { class: 'hub-badge', text: 'Planned' }),
          h('span', { class: 'hub-desc', text: o.desc }))]);
      btn.addEventListener('click', function () {
        var open = btn.getAttribute('aria-expanded') !== 'true';
        btn.setAttribute('aria-expanded', open ? 'true' : 'false'); note.hidden = !open;
      });
      return h('li', { class: 'hub-li-planned' }, btn, note);
    }

    // Roadmap destinations in blueprint order, after the six that exist. Keep in step with PROJECT_PROGRESS.md.
    var PLANNED = [
      { id: 'giving', name: 'Giving Center', icon: 'heart', desc: 'Wishlists, requests, group giving, emergency assistance and gift exchanges.' },
      { id: 'exchange', name: 'Family Exchange', icon: 'cart', desc: 'Family listings, giveaways, services and deals. Separate from the Shop.' },
      { id: 'challenges', name: 'Challenges', icon: 'trophy', desc: 'Family goals, activities, competitions and achievements.' },
      { id: 'legacy', name: 'Memories & Legacy', icon: 'album', desc: 'Albums, family stories, recordings, milestones and time capsules.' },
      { id: 'skills', name: 'Skills & Mentorship', icon: 'users', desc: 'A directory of skills relatives can offer, and mentorship.' },
      { id: 'travel', name: 'Travel Planner', icon: 'plane', desc: 'Family trips, itineraries, packing lists and coordination.' },
      { id: 'vault', name: 'Document Vault', icon: 'lock', desc: 'Planned secure storage for family documents.' },
      { id: 'assistant', name: 'Family Assistant', icon: 'sparkle', desc: 'Planned help with organizing family activities.' }
    ];

    X.VIEWS.hub = function (main) {
      var chatOn = !!(window.FCChat && X.CFG.chatEnabled !== false);
      var switcher = X.familySwitcher();
      var canSwitch = switcher && switcher.tagName === 'SELECT';
      main.appendChild(h('header', { class: 'hub-head' },
        h('p', { class: 'hub-kicker', text: 'Family Hub' }),
        h('h1', { class: 'hub-family', text: X.famName() }),
        canSwitch ? h('div', { class: 'hub-switch' }, h('label', { class: 'small muted', for: 'hub-fam', text: 'Switch family' }), (function () { switcher.id = 'hub-fam'; return switcher; })()) : null));

      var cards = [
        { id: 'community', title: 'Community', desc: 'Photos, posts and Shorts from your family.', icon: 'feed', href: '#/home' }
      ];
      if (chatOn) cards.push({ id: 'messages', title: 'Messages', desc: 'Family channels and private direct messages.', icon: 'comment', href: '#/chat' });
      cards.push({ id: 'tree', title: 'Family Tree', desc: 'See how everyone is connected.', icon: 'tree', href: '#/tree' });
      if (X.shopEnabled()) cards.push({ id: 'shop', title: 'Shop', desc: 'Turn family photos into gifts.', icon: 'bag', href: '#/shop' });
      cards.push({ id: 'recipes', title: 'Recipes', desc: 'The recipe book.', icon: 'book', href: RECIPES_URL, external: true });
      cards.push({ id: 'calendar', title: 'Calendar & Chores', desc: 'The family calendar and chore board.', icon: 'calendar', href: BOARD_URL, external: true });

      main.appendChild(h('nav', { 'aria-label': 'Family Hub' }, h('ul', { class: 'hub-grid' }, cards.map(card).concat(PLANNED.map(plannedCard)))));
    };
  }

  window.FCHub = { install: install, RECIPES_URL: RECIPES_URL, BOARD_URL: BOARD_URL };
})();
