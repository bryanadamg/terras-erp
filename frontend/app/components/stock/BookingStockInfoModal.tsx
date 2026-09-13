'use client';

import React, { useState } from 'react';
import ModalWrapper from '../shared/ModalWrapper';
import { Tabs } from '../shared/Tabs';
import { useLanguage } from '../../context/LanguageContext';
import { xpFont, modernFont, CODE_FONT, FormSection, CHIP_RADIUS, XP_BTN } from '../shared/xpTheme';
import { lvBtn } from '../shared/listViewTheme';
import { EPS, HEALTH, TERM } from './bookingStockTheme';

// "How is this calculated?" — the modeless explainer behind the ⓘ button on the
// Booking Stock toolbar, in English and Indonesian.
//
// It documents the ACTUAL netting pass, which lives in
// backend/app/api/stock.py :: _compute_booking_rows() (with the committed-supply
// and reject rules shared from services/netting_service.py). If that pass changes,
// BOTH languages change with it: a planner who trusts a stale explanation of a
// shortfall figure is worse off than one who has none.
//
// The copy lives in DOCS below rather than in LanguageContext deliberately —
// LanguageContext holds short UI labels, and dropping two screens of technical
// prose into it would bury them. Same reasoning as app/docs/content/*.ts.

type Lang = 'en' | 'id';

// A documentation block. `p`/`ul` take nodes so a sentence can still carry inline
// emphasis and coloured term references; `code` is plain text rendered monospace.
type Block =
    | { k: 'p'; body: React.ReactNode }
    | { k: 'code'; body: string }
    | { k: 'ul'; items: React.ReactNode[] };

type Doc = {
    title: string;
    close: string;
    /** The five names in the formula, in this language's vocabulary. */
    terms: { netFree: string; onHand: string; incoming: string; required: string; reserved: string };
    keying: React.ReactNode;
    health: { short: string; tight: string; ok: string };
    sections: { title: string; blocks: Block[] }[];
};

// Inline term reference, painted in the colour of the table column it names.
const T = ({ c, children }: { c: string; children: React.ReactNode }) =>
    <b style={{ color: c }}>{children}</b>;

const DOCS: Record<Lang, Doc> = {
    // ── English ────────────────────────────────────────────────────────────────
    en: {
        title: 'How Booking Stock is calculated',
        close: 'Close',
        terms: { netFree: 'Net Free', onHand: 'On Hand', incoming: 'Incoming', required: 'Required', reserved: 'Reserved' },
        keying: <>One row per <b>item + variant</b>, netted <b>plant-wide</b>. A row exists if some ongoing
            Manufacturing Order still demands that component, or if an open sales order is holding stock
            of it.</>,
        health: {
            short: 'net free is negative: the demand cannot be met',
            tight: `net free is zero (±${EPS}): covered with nothing spare`,
            ok: 'net free is positive',
        },
        sections: [
            {
                title: '1 · Which orders are in scope',
                blocks: [
                    { k: 'p', body: <>Every Manufacturing Order whose status is <b>PENDING</b>, <b>IN&nbsp;PROGRESS</b> or <b>DELIVERED</b> is
                        walked, plant-wide. Each one is first reduced to what it has <i>left to do</i>:</> },
                    { k: 'code', body: 'completed   = Σ qty_completed of completion logs that are NOT rejected\noutstanding = MO qty − completed' },
                    { k: 'p', body: <>An MO with <code>outstanding ≤ 0</code> contributes nothing — neither demand nor supply.
                        <b> DELIVERED</b> orders are included for exactly that reason: they normally net to zero, but if their
                        quantity is later raised, or their output is rejected, they re-enter the calculation on their own.</> },
                    { k: 'p', body: <>Everything downstream is therefore <b>outstanding-based</b>: quantity already produced stops
                        being counted, so the figures fall as the floor logs work rather than only when an order closes.</> },
                ],
            },
            {
                title: '2 · Required — outstanding demand',
                blocks: [
                    { k: 'p', body: <>Demand comes from each order's <b>planned components</b> — the BOM lines snapshotted at MO
                        creation, not the live BOM. Editing a BOM never moves the requirement of an order already in flight.</> },
                    { k: 'code', body: 'required = outstanding × percentage ÷ 100          (percentage lines)\nrequired = outstanding × qty                       (fixed-qty lines)\nrequired = required × (1 + BOM tolerance % ÷ 100)  (if the BOM sets one)' },
                    { k: 'p', body: <>Contributions are summed across every order, and kept per-order: expanding a row lists each
                        MO under <T c={TERM.required}>Required by</T> with its own share, so a shortfall can be traced to the
                        orders causing it.</> },
                ],
            },
            {
                title: '3 · Incoming — scheduled receipts',
                blocks: [
                    { k: 'p', body: <><T c={TERM.incoming}>Incoming</T> is the <b>outstanding output of orders already in flight that
                        produce this item</b> — work the plant is going to finish anyway, so it is credited before you decide to
                        buy or make more.</> },
                    { k: 'p', body: <>One rule removes output from this pool — the <b>committed-supply rule</b>. An order's output is
                        treated as promised, and never offered to other demand, when <i>all</i> of these hold:</> },
                    { k: 'ul', items: [
                        <>it is a <b>root</b> order (it has no parent MO), and</>,
                        <>it is not flagged as a <b>shared component</b>, and</>,
                        <>it is linked to a <b>sales order</b> — directly, or through its Production Run.</>,
                    ] },
                    { k: 'p', body: <>Child and shared-component orders always stay in supply (their output is already balanced by the
                        consuming order's component demand), and an uncommitted root is a deliberate stock-build, so its output is
                        deliberately free. <b>Purchase orders are not counted</b> — incoming is production only.</> },
                ],
            },
            {
                title: '4 · On Hand — physical good stock',
                blocks: [
                    { k: 'p', body: <><T c={TERM.onHand}>On Hand</T> is the current stock balance summed across <b>every location</b> for
                        that item and variant. Netting is deliberately location-agnostic — one plant, one pool — which is why the
                        Location column reads <i>Plant-wide</i> on every row.</> },
                    { k: 'p', body: <>Lots that are not good stock are excluded: <b>REJECTED</b>, <b>REJECT&nbsp;USABLE</b> and
                        <b> DISPOSED</b>. A reject-usable lot may still be picked deliberately, but it must never silently satisfy
                        planned demand, so it does not count here.</> },
                ],
            },
            {
                title: '5 · Reserved — stock promised to a sales order',
                blocks: [
                    { k: 'p', body: <><T c={TERM.reserved}>Reserved</T> is finished goods that are physically on hand but already
                        promised to an open sales order. It is subtracted for the same reason <T c={TERM.required}>Required</T> is:
                        the stock exists, but you may not plan against it.</> },
                    { k: 'p', body: <>A reservation is written when a <b>Production Run created for a sales order</b> covers part of
                        its finished goods from stock. That covered quantity produces <i>no</i> Manufacturing Order — so without a
                        reservation it would leave no trace at all, and the next sales order would net the same physical pile away
                        a second time. Both orders would then be planned short of the same stock.</> },
                    { k: 'code', body: 'reserved = Σ (qty − qty_released) of ACTIVE reservations\n           whose sales order is still PENDING / READY / PARTIAL' },
                    { k: 'p', body: <>A reservation stops counting on its own once its order reaches <b>SENT</b>, <b>DELIVERED</b> or
                        <b> CANCELLED</b>, and is drawn down at <b>goods issue</b> — the point the stock physically leaves. Packing
                        does not release it: packing only turns bulk into cartons of the same item, so on hand has not changed and
                        releasing there would subtract the same quantity twice.</> },
                    { k: 'p', body: <>Two things clear a hold early: deleting the Production Run (its reservations go with it), and
                        the <b>release</b> action on the sales order's lineage panel, for an order put on hold or stock the customer
                        no longer wants held.</> },
                    { k: 'p', body: <>Expanding a row lists each holder under <T c={TERM.reserved}>Reserved by</T>, so a shortfall
                        caused by a promise rather than by production can be traced to the order that made it.</> },
                ],
            },
            {
                title: '6 · How a row is keyed',
                blocks: [
                    { k: 'p', body: <>Rows are keyed by <b>(item, variant)</b> — the sorted set of attribute values, with a finished
                        good's colour folded in as a trailing token so two shades of one item net separately. Demand and stock are
                        matched on that exact key.</> },
                    { k: 'p', body: <>Consequence worth knowing: <b>lot-identity items</b> (beams, lot-tracked items) carry their
                        identity in the batch, not in the variant key, so their balance rows have an empty variant. If such a
                        component is demanded <i>with</i> attribute values, its on-hand will not match that key here. The
                        Production Run material panel compensates for this; this page does not.</> },
                ],
            },
            {
                title: '7 · How fresh the numbers are',
                blocks: [
                    { k: 'p', body: <>The netting pass is expensive, so it is computed once and shared. Results are held for
                        <b> 60&nbsp;seconds</b>, and are marked stale immediately by any stock, Manufacturing Order, Work Order or
                        Production Run change.</> },
                    { k: 'p', body: <>Stale rows keep being served: a request returns what is cached <i>now</i> and starts a single
                        recompute in the background, so the next load is fresh. Between a shop-floor change and that refresh, a
                        figure can be a few seconds behind — an accepted trade for never blocking the page on a full recompute.
                        <b> Refresh</b> re-reads that shared result rather than forcing a recompute — if it was stale, what you see
                        may still be the previous figures, with the new ones arriving on the next read.</> },
                ],
            },
            {
                title: '8 · What this figure is not',
                blocks: [
                    { k: 'ul', items: [
                        <><b>Not an allocation, except for <T c={TERM.reserved}>Reserved</T>.</b> Demand and supply here are
                            advisory — they say who <i>wants</i> what. <T c={TERM.reserved}>Reserved</T> is the one column that
                            records a real claim, and even it holds a <i>quantity</i> of an item, never a particular lot: which
                            roll or carton ships is decided later, at packing.</>,
                        <><b>Not a purchasing forecast.</b> Open purchase orders never appear as incoming.</>,
                        <><b>Not per-location.</b> A positive net free does not promise the stock sits at the work centre that
                            needs it.</>,
                        <><b>Not a dispatch decision.</b> The Work Queue answers "what can I start next?", walking on-hand stock in
                            priority-date order so two orders needing the same greige cannot both read READY. Booking Stock
                            intentionally does no such ordering — it reports the whole plant's balance in one figure.</>,
                    ] },
                ],
            },
        ],
    },

    // ── Bahasa Indonesia ───────────────────────────────────────────────────────
    id: {
        title: 'Cara Stok Booking dihitung',
        close: 'Tutup',
        terms: { netFree: 'Sisa Bebas', onHand: 'Tersedia', incoming: 'Masuk', required: 'Dibutuhkan', reserved: 'Dipesan' },
        keying: <>Satu baris per <b>item + varian</b>, dihitung <b>seluruh pabrik</b>. Sebuah baris muncul jika
            masih ada Perintah Produksi (MO) berjalan yang membutuhkan komponen tersebut, atau jika ada sales
            order terbuka yang menahan stoknya.</>,
        health: {
            short: 'sisa bebas negatif: kebutuhan tidak dapat dipenuhi',
            tight: `sisa bebas nol (±${EPS}): cukup persis, tanpa cadangan`,
            ok: 'sisa bebas positif',
        },
        sections: [
            {
                title: '1 · Perintah produksi yang dihitung',
                blocks: [
                    { k: 'p', body: <>Setiap Perintah Produksi (MO) dengan status <b>PENDING</b>, <b>IN&nbsp;PROGRESS</b> atau
                        <b> DELIVERED</b> ditelusuri, seluruh pabrik. Masing-masing lebih dahulu diringkas menjadi
                        <i> sisa pekerjaannya</i>:</> },
                    { k: 'code', body: 'selesai     = Σ qty_completed dari log penyelesaian yang TIDAK ditolak\noutstanding = qty MO − selesai' },
                    { k: 'p', body: <>MO dengan <code>outstanding ≤ 0</code> tidak menyumbang apa pun — tidak kebutuhan, tidak pasokan.
                        Order <b>DELIVERED</b> tetap disertakan justru karena itu: normalnya bernilai nol, tetapi bila kuantitasnya
                        kemudian dinaikkan, atau hasilnya ditolak, order tersebut kembali masuk perhitungan dengan sendirinya.</> },
                    { k: 'p', body: <>Karena itu seluruh perhitungan berbasis <b>sisa (outstanding)</b>: kuantitas yang sudah diproduksi
                        berhenti dihitung, sehingga angkanya menurun seiring lantai produksi mencatat hasil kerja — bukan hanya saat
                        order ditutup.</> },
                ],
            },
            {
                title: '2 · Dibutuhkan — kebutuhan sisa',
                blocks: [
                    { k: 'p', body: <>Kebutuhan berasal dari <b>komponen terencana</b> setiap order — baris BOM yang disalin (snapshot)
                        saat MO dibuat, bukan BOM yang berlaku sekarang. Mengubah BOM tidak pernah menggeser kebutuhan order yang
                        sudah berjalan.</> },
                    { k: 'code', body: 'dibutuhkan = outstanding × persentase ÷ 100            (baris persentase)\ndibutuhkan = outstanding × qty                         (baris qty tetap)\ndibutuhkan = dibutuhkan × (1 + toleransi BOM % ÷ 100)  (bila BOM mengatur toleransi)' },
                    { k: 'p', body: <>Kontribusi dijumlahkan dari seluruh order, dan tetap disimpan per order: membuka sebuah baris akan
                        menampilkan setiap MO di bagian <T c={TERM.required}>Dibutuhkan oleh</T> beserta porsinya masing-masing,
                        sehingga kekurangan stok dapat dilacak sampai ke order penyebabnya.</> },
                ],
            },
            {
                title: '3 · Masuk — penerimaan terjadwal',
                blocks: [
                    { k: 'p', body: <><T c={TERM.incoming}>Masuk</T> adalah <b>sisa hasil produksi dari order yang sudah berjalan dan
                        memproduksi item ini</b> — pekerjaan yang memang akan diselesaikan pabrik, sehingga diperhitungkan sebelum
                        Anda memutuskan untuk membeli atau memproduksi lagi.</> },
                    { k: 'p', body: <>Ada satu aturan yang mengeluarkan hasil produksi dari kelompok ini — <b>aturan pasokan
                        terikat</b>. Hasil sebuah order dianggap sudah dijanjikan, dan tidak pernah ditawarkan ke kebutuhan lain,
                        bila <i>semua</i> syarat berikut terpenuhi:</> },
                    { k: 'ul', items: [
                        <>order tersebut adalah order <b>induk</b> (tidak memiliki MO induk di atasnya), dan</>,
                        <>tidak ditandai sebagai <b>komponen bersama</b> (shared component), dan</>,
                        <>terhubung ke <b>sales order</b> — langsung, atau melalui Production Run-nya.</>,
                    ] },
                    { k: 'p', body: <>Order anak dan order komponen bersama selalu tetap menjadi pasokan (hasilnya sudah diimbangi oleh
                        kebutuhan komponen order yang mengonsumsinya), sedangkan order induk yang tidak terikat adalah produksi untuk
                        stok yang memang disengaja, jadi hasilnya sengaja dibiarkan bebas. <b>Purchase order tidak
                        dihitung</b> — Masuk hanya berasal dari produksi.</> },
                ],
            },
            {
                title: '4 · Tersedia — stok fisik yang baik',
                blocks: [
                    { k: 'p', body: <><T c={TERM.onHand}>Tersedia</T> adalah saldo stok saat ini yang dijumlahkan dari <b>seluruh
                        lokasi</b> untuk item dan varian tersebut. Perhitungan ini sengaja tidak membedakan lokasi — satu pabrik,
                        satu kumpulan stok — karena itu kolom Lokasi selalu berisi <i>Plant-wide</i> di setiap baris.</> },
                    { k: 'p', body: <>Lot yang bukan stok baik dikecualikan: <b>REJECTED</b>, <b>REJECT&nbsp;USABLE</b> dan
                        <b> DISPOSED</b>. Lot reject-usable masih boleh diambil secara sengaja, tetapi tidak boleh diam-diam memenuhi
                        kebutuhan yang sudah direncanakan, sehingga tidak dihitung di sini.</> },
                ],
            },
            {
                title: '5 · Dipesan — stok yang dijanjikan ke sales order',
                blocks: [
                    { k: 'p', body: <><T c={TERM.reserved}>Dipesan</T> adalah barang jadi yang secara fisik ada di gudang tetapi sudah
                        dijanjikan kepada sales order yang masih terbuka. Angka ini dikurangkan dengan alasan yang sama seperti
                        <T c={TERM.required}> Dibutuhkan</T>: stoknya ada, tetapi tidak boleh Anda rencanakan untuk keperluan
                        lain.</> },
                    { k: 'p', body: <>Pemesanan dicatat ketika sebuah <b>Production Run yang dibuat untuk sales order</b> menutupi
                        sebagian kebutuhan barang jadinya dari stok. Kuantitas yang tertutup itu <i>tidak</i> menghasilkan Perintah
                        Produksi — jadi tanpa pencatatan pemesanan, kuantitas tersebut tidak meninggalkan jejak apa pun, dan sales
                        order berikutnya akan memakai stok fisik yang sama untuk kedua kalinya. Akibatnya kedua order sama-sama
                        direncanakan kekurangan stok yang sama.</> },
                    { k: 'code', body: 'dipesan = Σ (qty − qty_released) dari pemesanan berstatus ACTIVE\n          yang sales order-nya masih PENDING / READY / PARTIAL' },
                    { k: 'p', body: <>Sebuah pemesanan berhenti dihitung dengan sendirinya begitu order-nya mencapai <b>SENT</b>,
                        <b> DELIVERED</b> atau <b>CANCELLED</b>, dan dikurangi saat <b>barang keluar (goods issue)</b> — yaitu saat
                        stok benar-benar meninggalkan gudang. Packing tidak melepasnya: packing hanya mengubah curah menjadi karton
                        dari item yang sama, sehingga stok tersedia tidak berubah, dan melepas di sana berarti mengurangi kuantitas
                        yang sama dua kali.</> },
                    { k: 'p', body: <>Dua hal dapat melepas tahanan lebih awal: menghapus Production Run-nya (pemesanannya ikut
                        terhapus), dan tombol <b>lepas</b> pada panel lineage sales order — untuk order yang ditunda atau stok yang
                        tidak lagi ingin ditahan pelanggan.</> },
                    { k: 'p', body: <>Membuka sebuah baris akan menampilkan setiap penahan di bagian <T c={TERM.reserved}>Dipesan
                        oleh</T>, sehingga kekurangan stok yang disebabkan oleh janji — bukan oleh produksi — dapat dilacak sampai
                        ke order yang membuatnya.</> },
                ],
            },
            {
                title: '6 · Cara sebuah baris dikunci',
                blocks: [
                    { k: 'p', body: <>Baris dikunci berdasarkan <b>(item, varian)</b> — kumpulan nilai atribut yang diurutkan, dengan
                        warna barang jadi disisipkan sebagai token di akhir agar dua shade dari satu item dihitung terpisah.
                        Kebutuhan dan stok dipertemukan tepat pada kunci tersebut.</> },
                    { k: 'p', body: <>Konsekuensi yang perlu diketahui: <b>item ber-identitas lot</b> (beam, item lot-tracked) membawa
                        identitasnya pada batch, bukan pada kunci varian, sehingga baris saldonya memiliki varian kosong. Bila
                        komponen semacam itu diminta <i>beserta</i> nilai atribut, stok tersedianya tidak akan cocok dengan kunci
                        tersebut di halaman ini. Panel material Production Run mengompensasi hal ini; halaman ini tidak.</> },
                ],
            },
            {
                title: '7 · Seberapa baru angka yang ditampilkan',
                blocks: [
                    { k: 'p', body: <>Perhitungan ini mahal, jadi dijalankan sekali lalu dipakai bersama. Hasilnya disimpan selama
                        <b> 60&nbsp;detik</b>, dan langsung ditandai kedaluwarsa oleh setiap perubahan stok, Perintah Produksi (MO),
                        Work Order, atau Production Run.</> },
                    { k: 'p', body: <>Baris yang kedaluwarsa tetap disajikan: permintaan mengembalikan apa yang ada di simpanan
                        <i> sekarang</i> lalu memulai satu perhitungan ulang di belakang, agar pemuatan berikutnya sudah baru.
                        Di antara perubahan di lantai produksi dan penyegaran itu, sebuah angka bisa tertinggal beberapa detik —
                        pertukaran yang disengaja agar halaman tidak pernah tertahan menunggu perhitungan penuh. <b>Refresh</b>
                        membaca ulang hasil bersama tersebut, bukan memaksa perhitungan ulang — bila sudah kedaluwarsa, yang Anda
                        lihat bisa masih angka sebelumnya, dan angka barunya muncul pada pembacaan berikutnya.</> },
                ],
            },
            {
                title: '8 · Yang BUKAN arti angka ini',
                blocks: [
                    { k: 'ul', items: [
                        <><b>Bukan alokasi, kecuali kolom <T c={TERM.reserved}>Dipesan</T>.</b> Kebutuhan dan pasokan di sini
                            bersifat saran — angkanya menyatakan siapa yang <i>membutuhkan</i> apa.
                            <T c={TERM.reserved}> Dipesan</T> adalah satu-satunya kolom yang mencatat klaim nyata, dan itu pun
                            menahan <i>kuantitas</i> sebuah item, bukan lot tertentu: roll atau karton mana yang dikirim baru
                            ditentukan kemudian, saat packing.</>,
                        <><b>Bukan ramalan pembelian.</b> Purchase order yang masih terbuka tidak pernah muncul sebagai Masuk.</>,
                        <><b>Bukan per lokasi.</b> Sisa bebas yang positif tidak menjamin stoknya berada di work center yang
                            membutuhkannya.</>,
                        <><b>Bukan keputusan dispatch.</b> Work Queue menjawab "apa yang bisa saya mulai berikutnya?", dengan
                            menelusuri stok tersedia berurutan menurut tanggal prioritas sehingga dua order yang membutuhkan greige
                            yang sama tidak bisa dua-duanya terbaca READY. Stok Booking memang tidak melakukan pengurutan seperti
                            itu — ia melaporkan saldo seluruh pabrik dalam satu angka.</>,
                    ] },
                ],
            },
        ],
    },
};

export default function BookingStockInfoModal({ isOpen, onClose }: {
    isOpen: boolean;
    onClose: () => void;
}) {
    const { language } = useLanguage();

    // Opens on the tab matching the app's current language, so the usual reader
    // never has to switch — the other tab is there for the times a figure has to be
    // explained to someone who reads the other language (or quoted to the client).
    const [lang, setLang] = useState<Lang>(language === 'id' ? 'id' : 'en');
    const doc = DOCS[lang];

    const font = xpFont;
    const bodyStyle: React.CSSProperties = {
        fontFamily: font, fontSize: 11,
        lineHeight: 1.55, color: '#2b2b2b',
    };
    // Formula fragments: monospace and tinted, so a reader can see at a glance that
    // these are the machine's rules rather than narrative.
    const codeBlock: React.CSSProperties = {
        fontFamily: CODE_FONT, fontSize: 10.5,
        background: '#f4f6fa', border: '1px solid #d5dbe6', borderRadius: CHIP_RADIUS,
        padding: '6px 9px', margin: '6px 0 7px', display: 'block',
        whiteSpace: 'pre-wrap', overflowX: 'auto', color: '#1a2c4a',
    };
    const kw = (color: string): React.CSSProperties => ({ color, fontWeight: 700 });

    const renderBlock = (b: Block, i: number, lastBlock: boolean) => {
        const tail = lastBlock ? 0 : 7;
        switch (b.k) {
            case 'code':
                return <code key={i} style={{ ...codeBlock, marginBottom: lastBlock ? 0 : 7 }}>{b.body}</code>;
            case 'ul':
                return (
                    <ul key={i} style={{ margin: `0 0 ${tail}px`, paddingLeft: 18 }}>
                        {b.items.map((it, j) => (
                            <li key={j} style={{ marginBottom: j === b.items.length - 1 ? 0 : 4 }}>{it}</li>
                        ))}
                    </ul>
                );
            default:
                return <p key={i} style={{ margin: `0 0 ${tail}px` }}>{b.body}</p>;
        }
    };

    return (
        <ModalWrapper
            isOpen={isOpen}
            onClose={onClose}
            modeless
            size="xl"
            variant="info"
            title={<><i className="bi bi-info-circle me-1" />{doc.title}</>}
            banner={
                <Tabs<Lang>
                    classic
                    activeKey={lang}
                    onChange={setLang}
                    tabs={[
                        { key: 'en', label: 'English', icon: 'bi-translate' },
                        { key: 'id', label: 'Bahasa Indonesia', icon: 'bi-translate' },
                    ]}
                />
            }
            footer={
                <button type="button" className={XP_BTN} style={lvBtn(true)} onClick={onClose}>{doc.close}</button>
            }
        >
            <div style={bodyStyle}>
                {/* ── The formula itself ───────────────────────────────────────── */}
                <div style={{
                    border: `1px solid ${'#a8b4c8'}`,
                    borderRadius: 6, background: '#fbfcfe',
                    padding: '10px 12px', marginBottom: 12,
                }}>
                    <div style={{
                        fontFamily: CODE_FONT, fontSize: 13,
                        textAlign: 'center', letterSpacing: '0.02em', color: '#1a2c4a',
                    }}>
                        <b>{doc.terms.netFree}</b>{'  =  '}
                        <span style={kw(TERM.onHand)}>{doc.terms.onHand}</span>{'  +  '}
                        <span style={kw(TERM.incoming)}>{doc.terms.incoming}</span>{'  −  '}
                        <span style={kw(TERM.required)}>{doc.terms.required}</span>{'  −  '}
                        <span style={kw(TERM.reserved)}>{doc.terms.reserved}</span>
                    </div>
                    <div style={{ marginTop: 8, fontSize: 10.5, color: '#555', textAlign: 'center' }}>
                        {doc.keying}
                    </div>
                    <div style={{
                        marginTop: 9, paddingTop: 8, borderTop: '1px dashed #ccd4e0',
                        display: 'flex', gap: 14, flexWrap: 'wrap', justifyContent: 'center',
                        fontSize: 10,
                    }}>
                        {([
                            [HEALTH.short, doc.health.short],
                            [HEALTH.tight, doc.health.tight],
                            [HEALTH.ok, doc.health.ok],
                        ] as const).map(([band, note]) => (
                            <span key={band.label} style={{ color: band.color }}>
                                <i className="bi bi-square-fill" style={{ marginRight: 4 }} />
                                <b>{band.label}</b> — {note}
                            </span>
                        ))}
                    </div>
                </div>

                {/* ── The sections, in the selected language ───────────────────── */}
                {doc.sections.map((sec, si) => (
                    <FormSection key={sec.title} title={sec.title} classic
                        style={si === doc.sections.length - 1 ? { marginBottom: 0 } : undefined}>
                        {sec.blocks.map((b, bi) => renderBlock(b, bi, bi === sec.blocks.length - 1))}
                    </FormSection>
                ))}

                <div style={{ marginTop: 8, fontSize: 10, color: '#777' }}>
                    <i className="bi bi-braces" style={{ marginRight: 5 }} />
                    <code style={{ fontFamily: CODE_FONT }}>backend/app/api/stock.py → _compute_booking_rows()</code>
                </div>
            </div>
        </ModalWrapper>
    );
}
