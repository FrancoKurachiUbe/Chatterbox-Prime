"""Pruebas unitarias para selección automática de puerto libre ante WinError 10048."""

from __future__ import annotations

import socket
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.config import find_available_port, is_port_available


class TestServerPortFallback(unittest.TestCase):
    def test_find_available_port_skips_occupied_port(self) -> None:
        blocker = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        blocker.bind(("127.0.0.1", 0))
        blocker.listen(1)
        try:
            busy_port = blocker.getsockname()[1]
            self.assertFalse(is_port_available("127.0.0.1", busy_port))
            chosen = find_available_port("127.0.0.1", busy_port, max_tries=10)
            self.assertGreater(chosen, busy_port)
            self.assertTrue(is_port_available("127.0.0.1", chosen))
        finally:
            blocker.close()


if __name__ == "__main__":
    unittest.main()
