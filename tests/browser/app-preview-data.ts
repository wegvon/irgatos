import type {
  MailAccount,
  MailPage,
  MailSettings,
  MailThread,
} from "../../src/features/mail/model/mail";
import type { IdeasState } from "../../src/features/ideas/model/ideas";
import type { FeedItem, FeedOverview } from "../../src/features/feed/model/feed";

// Sample answers for the app preview, so Mail, Ideas and Feed show content
// instead of empty states.
const now = Date.now();
const MIN = 60_000;
const HOUR = 60 * MIN;

const mailSettings: MailSettings = { endpoint: "https://executor.example", hasKey: true };
const mailAccounts: MailAccount[] = [
  { id: "t", email: "me@example.com" },
  { id: "work", email: "me@work.example" },
];

const rows = [
  ["Ayşe Demir", "Toplantı notları ve sonraki adımlar", "Dünkü görüşmenin notlarını ekledim, perşembeye kadar dönersen sevinirim.", 12 * MIN, true, 3],
  ["GitHub", "[irgatos] Release 0.5.4 is ready", "The draft release is waiting for your review.", 48 * MIN, true, 1],
  ["Mert Kaya", "Re: Fatura", "Merhaba, faturayı ilettim. Bir sorun olursa haber ver.", 3 * HOUR, false, 2],
  ["Linear", "Weekly digest", "12 issues closed, 4 opened this week across your projects.", 7 * HOUR, false, 1],
  ["Elif Şahin", "Hafta sonu planı", "Cumartesi kahvaltıya ne dersin? Saat on gibi.", 26 * HOUR, false, 4],
] as const;

const mailList: MailPage = {
  threads: rows.map(([from, subject, snippet, ago, unread, count], i) => ({
    id: `thread-${i}`,
    account: i % 2 ? "work" : "t",
    subject,
    from,
    snippet,
    date: now - ago,
    unread,
    inInbox: true,
    messageCount: count,
  })),
  nextPageTokens: {},
  errors: [],
};

const mailThread: MailThread = {
  id: "thread-0",
  subject: "Toplantı notları ve sonraki adımlar",
  unread: true,
  inInbox: true,
  me: "me@example.com",
  drafts: [],
  messages: [
    {
      id: "m1",
      from: "Ayşe Demir <ayse@example.com>",
      to: "me@example.com",
      cc: "",
      date: now - 5 * HOUR,
      subject: "Toplantı notları ve sonraki adımlar",
      body: "Merhaba,\n\nDünkü görüşmenin notlarını ekledim. Öne çıkanlar:\n\n- Yeni tasarım perşembe sunulacak\n- Bütçe onayı bekleniyor\n\nSevgiler,\nAyşe",
      unread: false,
      attachments: ["notlar.pdf"],
      hidden: [],
    },
    {
      id: "m2",
      from: "Me <me@example.com>",
      to: "ayse@example.com",
      cc: "",
      date: now - 2 * HOUR,
      subject: "Re: Toplantı notları ve sonraki adımlar",
      body: "Teşekkürler Ayşe, perşembe uygun. Sunumdan önce taslağa bakarım.",
      quoted: "On Mon, Ayşe Demir wrote:\n> Dünkü görüşmenin notlarını ekledim.",
      unread: false,
      attachments: [],
      hidden: [],
    },
    {
      id: "m3",
      from: "Ayşe Demir <ayse@example.com>",
      to: "me@example.com",
      cc: "",
      date: now - 12 * MIN,
      subject: "Re: Toplantı notları ve sonraki adımlar",
      body: "Harika, perşembeye kadar dönersen sevinirim.",
      unread: true,
      attachments: [],
      hidden: [],
    },
  ],
};

const card = (
  id: string,
  listId: string,
  title: string,
  labelIds: string[] = [],
  tasks = 0,
) => ({
  id,
  listId,
  title,
  description: "",
  labelIds,
  project: null,
  tasks: Array.from({ length: tasks }, (_, i) => ({
    id: `${id}-t${i}`,
    text: `Adım ${i + 1}`,
    done: i === 0,
  })),
  dueAt: null,
  createdAt: now - 3 * 24 * HOUR,
  updatedAt: now - HOUR,
});

const ideas: IdeasState = {
  boards: [
    {
      id: "b1",
      title: "Fikirler",
      createdAt: now - 30 * 24 * HOUR,
      labels: [
        { id: "l1", name: "Uygulama", color: "blue" },
        { id: "l2", name: "Kişisel", color: "green" },
        { id: "l3", name: "Acil", color: "red" },
        { id: "l4", name: "Belki", color: "purple" },
      ],
      lists: [
        { id: "inbox", title: "Inbox", cards: [card("c1", "inbox", "Açık tema için yumuşak palet", ["l1"]), card("c2", "inbox", "Haftalık okuma listesi", ["l2"])] },
        { id: "exploring", title: "Exploring", cards: [card("c3", "exploring", "Sesli not → fikir kartı", ["l1", "l4"], 3)] },
        { id: "next", title: "Next up", cards: [card("c4", "next", "Mail özetini sabah bildirimi yap", ["l1", "l3"], 2)] },
        { id: "parked", title: "Parked", cards: [card("c5", "parked", "iPad için ayrı yerleşim", [])] },
      ],
    },
  ],
};

const feedOverview: FeedOverview = {
  interests: [
    { id: "i1", title: "Rust ve Tauri", description: "", enabled: true, createdAt: now, updatedAt: now, embedded: true },
    { id: "i2", title: "Yerel LLM", description: "", enabled: true, createdAt: now, updatedAt: now, embedded: true },
  ],
  threshold: 0.4,
  scoring: true,
  counts: { unread: 3, filtered: 5, saved: 1, unscored: 0 },
  lastCollected: { x: now - 40 * MIN },
  collector: null,
};

const post = (i: number, author: string, text: string, score: number): FeedItem => ({
  id: `p${i}`,
  source: "x",
  externalId: `${i}`,
  url: "https://example.com",
  author,
  authorName: author,
  text,
  summary: "",
  publishedAt: now - i * HOUR,
  collectedAt: now - i * HOUR,
  metrics: { likes: 120 * i, reposts: 14 * i },
  media: [],
  agentInterest: "",
  interestId: "i1",
  score,
  read: i > 2,
  saved: i === 1,
  similar: i === 2 ? 2 : 0,
});

const feedItems = {
  items: [
    post(1, "tauri_apps", "Tauri 2.6 is out: faster IPC, smaller bundles and a new window effects API on macOS.", 0.82),
    post(2, "rustlang", "Rust 1.95 stabilises async closures in traits. Here is what changes for library authors.", 0.71),
    post(3, "localai", "Running a 7B model at 60 tok/s on an M3 with the new Metal kernels.", 0.55),
  ],
  total: 3,
};

export const PREVIEW_DATA: Record<string, unknown> = {
  mail_settings: mailSettings,
  mail_accounts: mailAccounts,
  mail_list: mailList,
  mail_thread: mailThread,
  mail_thread_sessions: [],
  ideas_load: ideas,
  feed_overview: feedOverview,
  feed_items: feedItems,
};
