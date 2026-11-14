"""Legacy MySQL Administrator dump reader (pure stdlib, no DB)."""
from app.legacy.dump_reader import index_tables, iter_rows

FIXTURE = """-- MySQL Administrator dump 1.4
CREATE TABLE `ww_lag` (
  `Lag_nr` varchar(30) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

--
-- Dumping data for table `ww_lag`
--

/*!40000 ALTER TABLE `ww_lag` DISABLE KEYS */;
SET AUTOCOMMIT=0;
INSERT INTO `ww_lag` (`Lag_nr`,`Lag_name`,`Lag_res_d1`,`Lag_text`) VALUES
 ('GM01','O\\'Brien 5°',1.5e3,NULL),
 ('GDF','a\\\\b\\nc \\"q\\"',-2,'');
INSERT INTO `ww_lag` (`Lag_nr`,`Lag_name`,`Lag_res_d1`,`Lag_text`) VALUES
 ('GG01','x, (y)',0,'it''s');
/*!40000 ALTER TABLE `ww_lag` ENABLE KEYS */;

--
-- Definition of table `ww_li`
--
CREATE TABLE `ww_li` (
  `Li_lagnr` varchar(30) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

--
-- Dumping data for table `ww_li`
--

INSERT INTO `ww_li` (`Li_lagnr`,`Li_stck`) VALUES
 ('GJ01',720);
"""


def _dump(tmp_path):
    p = tmp_path / "d.sql"
    p.write_bytes(FIXTURE.encode("utf-8"))
    return str(p)


def test_index_tables_finds_each_data_section(tmp_path):
    idx = index_tables(_dump(tmp_path))
    assert set(idx) == {"ww_lag", "ww_li"}
    start, end = idx["ww_lag"]
    assert start < end <= idx["ww_li"][0]


def test_iter_rows_parses_mysql_values(tmp_path):
    path = _dump(tmp_path)
    idx = index_tables(path)
    rows = list(iter_rows(path, *idx["ww_lag"]))
    assert rows[0] == {"Lag_nr": "GM01", "Lag_name": "O'Brien 5°", "Lag_res_d1": 1500.0, "Lag_text": None}
    assert rows[1] == {"Lag_nr": "GDF", "Lag_name": 'a\\b\nc "q"', "Lag_res_d1": -2.0, "Lag_text": ""}
    assert rows[2] == {"Lag_nr": "GG01", "Lag_name": "x, (y)", "Lag_res_d1": 0.0, "Lag_text": "it's"}
    assert list(iter_rows(path, *idx["ww_li"])) == [{"Li_lagnr": "GJ01", "Li_stck": 720.0}]


EXTRACT_FIXTURE = """-- Dumping data for table `ww_li`
INSERT INTO `ww_li` (`Li_lagnr`,`Li_artnr`,`Li_sernr`,`Li_stck`) VALUES 
 ('GJ01','A','S1',5),
 ('GJ01','B','',3);
-- Dumping data for table `ww_snr`
INSERT INTO `ww_snr` (`Snr_artnr`,`Snr_sernr`,`Snr_sernr_h`) VALUES 
 ('A','S1','P1'),
 ('A','S2',''),
 ('B','S1','');
-- Dumping data for table `ww_vg`
INSERT INTO `ww_vg` (`Vg_nr`,`Vg_adrnr`,`Vg_anl`,`Vg_aend`) VALUES 
 ('1','K1','2023-01-02 00:00:00','2025-04-01 00:00:00'),
 ('2','K1','2024-01-02 00:00:00',NULL);
-- Dumping data for table `ww_we`
INSERT INTO `ww_we` (`We_nr`,`We_artnr`,`We_datum`) VALUES 
 (1,'A','2024-05-03 00:00:00'),
 (2,'A','2025-11-30 00:00:00'),
 (3,'B',NULL);
"""


def test_extract_writes_tables_filtered_lots_and_activity(tmp_path):
    import json
    from app.legacy.extract import extract
    dump = tmp_path / "d.sql"; dump.write_text(EXTRACT_FIXTURE, encoding="utf-8")
    work = tmp_path / "work"
    extract(str(dump), str(work))
    li = [json.loads(l) for l in open(work / "tables" / "ww_li.jsonl")]
    assert [r["Li_artnr"] for r in li] == ["A", "B"]
    snr = [json.loads(l) for l in open(work / "tables" / "ww_snr.jsonl")]
    assert [(r["Snr_artnr"], r["Snr_sernr"]) for r in snr] == [("A", "S1")]   # only lots ww_li names
    assert json.load(open(work / "item_last_move.json")) == {"A": "2025-11"}
    assert json.load(open(work / "partner_last_doc.json")) == {"K1": "2025-04"}
