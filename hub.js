/* Family Hub: the central screen people land on after signing in.
 * It only links to things that already exist. It does not read or write any family data of its own,
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

      main.appendChild(h('nav', { 'aria-label': 'Family Hub' }, h('ul', { class: 'hub-grid' }, cards.map(card))));
    };
  }

  window.FCHub = { install: install, RECIPES_URL: RECIPES_URL, BOARD_URL: BOARD_URL };
})();
