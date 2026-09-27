"""Indonesian national holidays (Hari Libur Nasional) — reference data.

Used by the weaving production calendar to highlight national holidays and let
a supervisor one-click adopt them as a machine's non-working day. Adoption is
explicit (per machine) — this list never auto-affects the working-day count.

NOTE: fixed-date holidays (1 Jan, 1 May, 1 Jun, 17 Aug, 25 Dec) are certain.
Lunar/movable dates (Imlek, Nyepi, Idul Fitri, Idul Adha, Waisak, Isra Mikraj,
Tahun Baru Islam, Maulid, Kenaikan/Wafat Isa) follow the government SKB and may
shift ±1 day — verify against the official decree before relying on them.
Cuti bersama (collective leave) are intentionally excluded; add per machine.
"""
from datetime import date

# Keyed by year. Each entry: (month, day, name).
_HOLIDAYS = {
    2025: [
        (1, 1, "Tahun Baru Masehi"),
        (1, 27, "Isra Mikraj Nabi Muhammad SAW"),
        (1, 29, "Tahun Baru Imlek 2576"),
        (3, 29, "Hari Suci Nyepi"),
        (3, 31, "Idul Fitri 1446 H"),
        (4, 1, "Idul Fitri 1446 H"),
        (4, 18, "Wafat Isa Almasih"),
        (5, 1, "Hari Buruh Internasional"),
        (5, 12, "Hari Raya Waisak"),
        (5, 29, "Kenaikan Isa Almasih"),
        (6, 1, "Hari Lahir Pancasila"),
        (6, 6, "Idul Adha 1446 H"),
        (6, 27, "Tahun Baru Islam 1447 H"),
        (8, 17, "Hari Kemerdekaan RI"),
        (9, 5, "Maulid Nabi Muhammad SAW"),
        (12, 25, "Hari Raya Natal"),
    ],
    2026: [
        (1, 1, "Tahun Baru Masehi"),
        (1, 16, "Isra Mikraj Nabi Muhammad SAW"),
        (2, 17, "Tahun Baru Imlek 2577"),
        (3, 19, "Hari Suci Nyepi"),
        (3, 20, "Idul Fitri 1447 H"),
        (3, 21, "Idul Fitri 1447 H"),
        (4, 3, "Wafat Isa Almasih"),
        (5, 1, "Hari Buruh Internasional"),
        (5, 14, "Kenaikan Isa Almasih"),
        (5, 27, "Idul Adha 1447 H"),
        (5, 31, "Hari Raya Waisak"),
        (6, 1, "Hari Lahir Pancasila"),
        (6, 16, "Tahun Baru Islam 1448 H"),
        (8, 17, "Hari Kemerdekaan RI"),
        (8, 25, "Maulid Nabi Muhammad SAW"),
        (12, 25, "Hari Raya Natal"),
    ],
    2027: [
        (1, 1, "Tahun Baru Masehi"),
        (1, 6, "Isra Mikraj Nabi Muhammad SAW"),
        (2, 6, "Tahun Baru Imlek 2578"),
        (3, 9, "Idul Fitri 1448 H"),
        (3, 10, "Idul Fitri 1448 H"),
        (3, 26, "Wafat Isa Almasih"),
        (4, 8, "Hari Suci Nyepi"),
        (5, 1, "Hari Buruh Internasional"),
        (5, 6, "Kenaikan Isa Almasih"),
        (5, 17, "Idul Adha 1448 H"),
        (5, 20, "Hari Raya Waisak"),
        (6, 1, "Hari Lahir Pancasila"),
        (6, 6, "Tahun Baru Islam 1449 H"),
        (8, 15, "Maulid Nabi Muhammad SAW"),
        (8, 17, "Hari Kemerdekaan RI"),
        (12, 25, "Hari Raya Natal"),
    ],
}


def holidays_for_year(year: int) -> list[dict]:
    """Return [{date, name}] for a year (empty if not curated)."""
    return [
        {"date": date(year, m, d).isoformat(), "name": name}
        for (m, d, name) in _HOLIDAYS.get(year, [])
    ]

