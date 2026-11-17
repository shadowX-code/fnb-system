import base64
import subprocess
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import Mock, patch
from uuid import uuid4

import bridge


class RecoveryTest(unittest.TestCase):
    def setUp(self):
        root = tempfile.TemporaryDirectory()
        self.addCleanup(root.cleanup)
        self.journal = Path(root.name) / "journal.json"
        self.calibration = Path(root.name) / "calibration.json"
        self.config = {"device": str(uuid4()), "printer": "Label", "name": "QA", "transport": "spooler"}
        self.job = {
            "id": str(uuid4()), "state": "Printing",
            "lease_until": (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat(),
            "snapshot": {"width_mm": 80, "height_mm": 90}, "quantity": 3,
            "raster": {"format": "mono1", "width": 639, "height": 719,
                       "data": base64.b64encode(bytes(80 * 719)).decode()},
        }
        self.rpc = Mock(side_effect=lambda config, session, name, **body: self.job if name == "claim" else {})
        self.inventory = Mock(return_value=[{"Name": "Label", "WorkOffline": False}])
        for attr, value in [("JOURNAL", self.journal), ("CALIBRATION", self.calibration),
                            ("rpc", self.rpc), ("inventory", self.inventory)]:
            patcher = patch.object(bridge, attr, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_interrupted_write_reports_unknown_and_retries_only_the_report(self):
        def interrupted():
            self.assertEqual(bridge.load(self.journal)["stage"], "submitting")
            raise KeyboardInterrupt

        with patch.object(bridge, "prepare", return_value=interrupted):
            with self.assertRaises(KeyboardInterrupt):
                bridge.cycle(self.config, {})
        claim = bridge.load(self.journal)["claim"]
        self.rpc.side_effect = OSError
        with self.assertRaises(OSError):
            bridge.cycle(self.config, {})
        self.rpc.reset_mock(side_effect=True)
        self.rpc.return_value = {}
        self.inventory.return_value = []
        bridge.cycle(self.config, {})
        self.assertFalse(self.journal.exists())
        args, body = self.rpc.call_args
        self.assertEqual(args[2], "report")
        self.assertEqual((body["p_claim"], body["p_state"]), (claim, "Unknown"))
        self.assertEqual([c.args[2] for c in self.rpc.call_args_list], ["report"])

    def test_offline_and_unreviewed_calibration_never_claim(self):
        self.inventory.return_value = [{"Name": "Label", "WorkOffline": True}]
        bridge.cycle(self.config, {})
        self.assertEqual(self.rpc.call_args.kwargs["p_status"], "Offline")
        self.inventory.return_value = [{"Name": "Label", "WorkOffline": False}]
        bridge.save(self.calibration, {"stage": "sent"})
        bridge.cycle(self.config, {})
        self.assertEqual(self.rpc.call_args.kwargs["p_status"], "Error")
        self.assertEqual([c.args[2] for c in self.rpc.call_args_list], ["device", "device"])

    def test_claim_retry_uses_same_id_and_sent_is_not_resent(self):
        def lost_claim(config, session, name, **body):
            if name == "claim":
                raise OSError

        self.rpc.side_effect = lost_claim
        with self.assertRaises(OSError):
            bridge.cycle(self.config, {})
        claim = bridge.load(self.journal)["claim"]
        self.rpc.side_effect = lambda config, session, name, **body: self.job if name == "claim" else {}
        submit = Mock(return_value="Spooler accepted")
        with patch.object(bridge, "prepare", return_value=submit):
            bridge.cycle(self.config, {})
            bridge.cycle(self.config, {})
        submit.assert_called_once()
        self.assertEqual([c.kwargs["p_claim"] for c in self.rpc.call_args_list if c.args[2] == "claim"], [claim, claim])
        self.assertEqual(self.rpc.call_args.kwargs["p_state"], "Sent")


class TransportTest(unittest.TestCase):
    def test_native_timeout_kills_without_waiting_for_a_stalled_driver(self):
        child = Mock(stdin=None, stdout=None)
        child.communicate.side_effect = subprocess.TimeoutExpired("print", 1)
        with patch.object(bridge.subprocess, "Popen", return_value=child):
            with self.assertRaises(subprocess.TimeoutExpired):
                bridge.command(["print"], timeout=1)
        child.kill.assert_called_once()
        child.wait.assert_not_called()

    def test_tspl_follows_windows_dimensions_polarity_and_count(self):
        values = bridge.calibration(3)
        output = bridge.tspl(*values, gap=2, invert=True)
        header = b"SIZE 80 mm,90 mm\r\nGAP 2 mm,0\r\nDIRECTION 1\r\nCLS\r\nBITMAP 0,0,80,719,0,"
        self.assertTrue(output.startswith(header))
        self.assertTrue(output.endswith(b"\r\nPRINT 1,3\r\n"))
        self.assertEqual(output[len(header)], 255)
        self.assertEqual(len(output) - len(header) - len(b"\r\nPRINT 1,3\r\n"), 80 * 719)

    def test_cups_uses_exact_media_and_disables_scaling(self):
        results = [b"PageSize/Media Size: *Custom.WIDTHxHEIGHT\n", b"request id is Label-123 (1 file)\n"]
        config = {"printer": "Label", "transport": "spooler"}
        with patch.object(bridge, "command", side_effect=results) as command:
            submit = bridge.prepare(config, bridge.calibration(1), "Calibration")
            self.assertIn("Label-123", submit())
        args, payload, _ = command.call_args.args
        self.assertIn("media=Custom.80x90mm", args)
        self.assertIn("print-scaling=none", args)
        self.assertIn("/MediaBox [0 0 226.771654 255.118110]", payload.decode("latin1"))
        self.assertIn(b"/Width 639 /Height 719", payload)


if __name__ == "__main__":
    unittest.main()
