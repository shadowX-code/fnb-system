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

    def test_old_serial_setup_cannot_claim_using_previous_calibration(self):
        self.config.update(transport="tspl", calibrated_labels=3)
        bridge.cycle(self.config, {})
        self.inventory.assert_called_once_with(self.config, probe_bluetooth=False)
        self.assertEqual(self.rpc.call_args.kwargs["p_status"], "Error")
        self.assertEqual([call.args[2] for call in self.rpc.call_args_list], ["device"])

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

    def test_full_d520_write_without_ack_reports_unknown_without_resending(self):
        self.config.update(transport="tspl", bluetooth_address="test-address", calibrated_labels=3, gap=2, invert=True)
        with patch.object(
            bridge, "command", side_effect=subprocess.CalledProcessError(8, "print")
        ) as command:
            bridge.cycle(self.config, {})
            self.assertEqual(bridge.load(self.journal)["outcome"], "Unknown")
            bridge.cycle(self.config, {})
        command.assert_called_once()
        self.assertEqual(self.rpc.call_args.kwargs["p_state"], "Unknown")
        self.assertIn("write completed", self.rpc.call_args.kwargs["p_detail"])
        self.assertFalse(self.journal.exists())


class TransportTest(unittest.TestCase):
    def test_native_timeout_kills_without_waiting_for_a_stalled_driver(self):
        child = Mock(stdin=None, stdout=None)
        child.communicate.side_effect = subprocess.TimeoutExpired("print", 1)
        with patch.object(bridge.subprocess, "Popen", return_value=child):
            with self.assertRaises(subprocess.TimeoutExpired):
                bridge.command(["print"], timeout=1)
        child.kill.assert_called_once()
        child.wait.assert_not_called()

    def test_tspl_mode_four_frames_canonical_raster_and_one_copy(self):
        values = bridge.calibration(1)
        output = bridge.tspl(*values, gap=2, invert=True)
        marker = b"BITMAP 0,0,80,719,4,"
        header, frames = output.split(marker, 1)
        self.assertIn(b"SIZE 80 mm,90 mm", header)
        self.assertIn(b"DIRECTION 1,0\r\n", header)
        stride = 80
        self.assertEqual(values[0][31 * stride + 4], 0)
        self.assertEqual(values[0][32 * stride + 4], 255)
        offset = 0
        for start in range(0, len(values[0]), 4096):
            raw = values[0][start:start + 4096]
            length = int.from_bytes(frames[offset:offset + 4], "little")
            block = frames[offset + 4:offset + 4 + length]
            if len(raw) <= 238:
                self.assertEqual(block[0] - 17, len(raw))
                data_start = 1
            else:
                data_start = 1
                while block[data_start] == 0:
                    data_start += 1
                self.assertEqual(18 + (data_start - 1) * 255 + block[data_start], len(raw))
                data_start += 1
            self.assertEqual(block[data_start:-3], bytes(x ^ 255 for x in raw))
            self.assertEqual(block[-3:], b"\x11\x00\x00")
            offset += 4 + length
        self.assertEqual(frames[offset:], b"\x00\x00\x00\x00\r\nPRINT 1,1\r\n")

    def test_native_receipt_errors_distinguish_no_ack_and_nak_without_retry(self):
        for code, detail in [(6, "write failed"), (7, "negative acknowledgment"), (8, "write completed")]:
            with self.subTest(code=code), patch.object(
                bridge, "command", side_effect=subprocess.CalledProcessError(code, "print")
            ) as command:
                with self.assertRaisesRegex(bridge.BridgeError, detail):
                    bridge.send_bluetooth("test-address", b"raster")
                command.assert_called_once()

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
