import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

const admin = readFileSync(new URL("../admin.js", import.meta.url), "utf8");

function sourceBetween(startMarker, endMarker) {
  const start = admin.indexOf(startMarker);
  const end = admin.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start,
    "expected source region: " + startMarker + " .. " + endMarker);
  return admin.slice(start, end);
}

const inboxSource = [
  sourceBetween("function privateChatEscape(value)", "function privateChatDate(value"),
  sourceBetween("function privateChatDate(value", "function privateChatStatusLabel(status)"),
  sourceBetween("function privateChatStatusLabel(status)", "function privateChatTopicLabel(topic)"),
  sourceBetween("function privateChatTopicLabel(topic)", "function privateChatRouteLabel(route)"),
  sourceBetween("function privateChatRouteLabel(route)", "function privateChatSelectedConversation()"),
  sourceBetween("function privateChatBucket(item)", "function privateChatRenderInbox()"),
  sourceBetween("function privateChatRenderInbox()", "function privateChatRenderMessages(messages)")
].join("\n");

const selectedSource = [
  sourceBetween("function privateChatSelectedConversation()", "function privateChatSetStatus(message"),
  sourceBetween("function privateChatRenderSelected()", "async function loadPrivateChatMessages(")
].join("\n");

function makeClassList() {
  const values = new Set();
  return {
    add(value) { values.add(value); },
    remove(value) { values.delete(value); },
    contains(value) { return values.has(value); },
    toggle(value, force) {
      const shouldAdd = force === undefined ? !values.has(value) : Boolean(force);
      if (shouldAdd) values.add(value);
      else values.delete(value);
      return shouldAdd;
    }
  };
}

function makeInboxHarness() {
  const countEls = Object.fromEntries(["pending", "active", "closed"].map(key =>
    [key, { textContent: "?" }]
  ));
  const filterButtons = ["pending", "active", "closed"].map(key => ({
    dataset: { privateChatFilter: key },
    attributes: {},
    classList: makeClassList(),
    setAttribute(name, value) { this.attributes[name] = value; },
    querySelector(selector) {
      return selector === "[data-private-chat-filter-count]" ? countEls[key] : null;
    }
  }));
  const inboxCount = { textContent: "?" };
  const list = { innerHTML: "" };
  const context = {
    privateChatConversations: [
      { id: "pending-consent", status: "pending_consent", product_name: "Pending consent", catalog_type: "technology", contact_route: null, created_at: "2026-10-28T12:00:00Z" },
      { id: "pending-advisor", status: "pending_advisor", product_name: "Pending advisor", catalog_type: "technology", contact_route: "support", created_at: "2026-10-28T12:01:00Z" },
      { id: "active", status: "advisor_active", product_name: "Active chat", catalog_type: "perfumery", contact_route: "buy", claimed_by: "admin-1", created_at: "2026-10-28T12:02:00Z" },
      { id: "closed", status: "closed", product_name: "Closed chat", catalog_type: "technology", contact_route: "support", created_at: "2026-10-28T12:03:00Z" },
      { id: "declined", status: "declined_pending_delete", product_name: "Declined chat", catalog_type: "technology", contact_route: "buy", created_at: "2026-10-28T12:04:00Z" }
    ],
    privateChatSelectedId: "pending-consent",
    privateChatActiveFilter: "pending",
    privateChatListEl: list,
    document: {
      querySelectorAll(selector) {
        return selector === "[data-private-chat-filter]" ? filterButtons : [];
      },
      getElementById(id) {
        return id === "private-chat-admin-inbox-count" ? inboxCount : null;
      }
    }
  };
  vm.runInNewContext(inboxSource, context);
  return { context, countEls, filterButtons, inboxCount, list };
}

function makeSelectedHarness() {
  const elementIds = [
    "private-chat-admin-thread-kicker",
    "private-chat-admin-thread-title",
    "private-chat-admin-thread-meta",
    "private-chat-admin-product-link",
    "private-chat-admin-claim",
    "private-chat-admin-purchase",
    "private-chat-admin-close",
    "private-chat-admin-actions",
    "private-chat-admin-messages"
  ];
  const elements = Object.fromEntries(elementIds.map(id => [id, {
    id, hidden: true, textContent: "", href: "", style: {}
  }]));
  const selectedPanel = { hidden: true, style: {} };
  const thread = { hidden: true, style: {} };
  const replyForm = { hidden: true, style: {} };
  const layoutClassList = makeClassList();
  const context = {
    privateChatConversations: [],
    privateChatSelectedId: "",
    currentUser: { id: "admin-1" },
    privateChatSelectedPanel: selectedPanel,
    privateChatEmptyPanel: null,
    privateChatThreadEl: thread,
    privateChatLayoutEl: { classList: layoutClassList },
    privateChatReplyForm: replyForm,
    privateChatRenderMessages() {},
    privateChatSetStatus() {},
    privateChatStatusLabel: status => status,
    privateChatRouteLabel: route => route || "Sin elegir",
    privateChatTopicLabel: topic => topic || "Consulta",
    privateChatDate: () => "12:00",
    document: {
      getElementById(id) {
        return elements[id] || null;
      }
    }
  };
  vm.runInNewContext(selectedSource, context);
  return { context, elements, selectedPanel, thread, replyForm, layoutClassList };
}

function selectConversation(harness, item) {
  harness.context.privateChatConversations = [item];
  harness.context.privateChatSelectedId = item.id;
  harness.context.privateChatRenderSelected();
  return {
    claimHidden: harness.elements["private-chat-admin-claim"].hidden,
    purchaseHidden: harness.elements["private-chat-admin-purchase"].hidden,
    closeHidden: harness.elements["private-chat-admin-close"].hidden,
    replyHidden: harness.replyForm.hidden,
    actionDisplay: harness.elements["private-chat-admin-actions"].style.display,
    selectedHidden: harness.selectedPanel.hidden,
    threadHidden: harness.thread.hidden
  };
}

test("inbox status buckets, counters and filtering agree for pending, active and finalized chats", () => {
  const h = makeInboxHarness();
  h.context.privateChatRenderInbox();

  assert.equal(h.countEls.pending.textContent, "2");
  assert.equal(h.countEls.active.textContent, "1");
  assert.equal(h.countEls.closed.textContent, "2");
  assert.equal(h.inboxCount.textContent, "2");
  assert.equal(h.filterButtons[0].attributes["aria-pressed"], "true");
  assert.equal(h.filterButtons[1].attributes["aria-pressed"], "false");
  assert.match(h.list.innerHTML, /data-private-chat-select="pending-consent"/);
  assert.match(h.list.innerHTML, /data-private-chat-select="pending-advisor"/);
  assert.doesNotMatch(h.list.innerHTML, /data-private-chat-select="active"/);

  h.context.privateChatActiveFilter = "active";
  h.context.privateChatSelectedId = "pending-consent";
  h.context.privateChatRenderInbox();
  assert.equal(h.inboxCount.textContent, "1");
  assert.equal(h.context.privateChatSelectedId, "", "selection from another bucket must be cleared");
  assert.match(h.list.innerHTML, /data-private-chat-select="active"/);
  assert.doesNotMatch(h.list.innerHTML, /data-private-chat-select="closed"/);

  h.context.privateChatActiveFilter = "closed";
  h.context.privateChatRenderInbox();
  assert.equal(h.inboxCount.textContent, "2");
  assert.match(h.list.innerHTML, /data-private-chat-select="closed"/);
  assert.match(h.list.innerHTML, /data-private-chat-select="declined"/);
  assert.doesNotMatch(h.list.innerHTML, /data-private-chat-select="pending-advisor"/);

  h.context.privateChatConversations = [];
  h.context.privateChatRenderInbox();
  assert.match(h.list.innerHTML, /Todavía no hay conversaciones finalizadas/);
});

test("selected conversation shows only actions allowed by the current ownership and status", () => {
  const h = makeSelectedHarness();
  h.context.privateChatRenderSelected();
  assert.equal(h.thread.hidden, true);
  assert.equal(h.thread.style.display, "none");
  assert.equal(h.selectedPanel.hidden, true);
  assert.equal(h.layoutClassList.contains("has-selection"), false);
  assert.equal(h.replyForm.hidden, true);

  const pending = selectConversation(h, {
    id: "pending", status: "pending_advisor", claimed_by: null,
    catalog_type: "technology", contact_route: "support", payment_topic: "product",
    product_name: "Pending request", product_url: "https://jb-collections.pages.dev/"
  });
  assert.deepEqual(pending, {
    claimHidden: false, purchaseHidden: true, closeHidden: false, replyHidden: true,
    actionDisplay: "flex", selectedHidden: false, threadHidden: false
  });

  const activeOwned = selectConversation(h, {
    id: "active-owned", status: "advisor_active", claimed_by: "admin-1",
    catalog_type: "technology", contact_route: "buy", consent_choice: "yes",
    payment_topic: "product", product_name: "Owned purchase",
    product_url: "https://jb-collections.pages.dev/"
  });
  assert.deepEqual(activeOwned, {
    claimHidden: true, purchaseHidden: false, closeHidden: false, replyHidden: false,
    actionDisplay: "flex", selectedHidden: false, threadHidden: false
  });

  const activeOther = selectConversation(h, {
    id: "active-other", status: "advisor_active", claimed_by: "admin-2",
    catalog_type: "technology", contact_route: "support", payment_topic: "product",
    product_name: "Other advisor",
    product_url: "https://jb-collections.pages.dev/"
  });
  assert.deepEqual(activeOther, {
    claimHidden: true, purchaseHidden: true, closeHidden: true, replyHidden: true,
    actionDisplay: "none", selectedHidden: false, threadHidden: false
  });

  const closed = selectConversation(h, {
    id: "closed", status: "closed", claimed_by: null,
    catalog_type: "technology", contact_route: "support", payment_topic: "product",
    product_name: "Closed chat",
    product_url: "https://jb-collections.pages.dev/"
  });
  assert.deepEqual(closed, {
    claimHidden: true, purchaseHidden: true, closeHidden: true, replyHidden: true,
    actionDisplay: "none", selectedHidden: false, threadHidden: false
  });
});
