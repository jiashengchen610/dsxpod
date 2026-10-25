"""Vercel Python 函式入口：/api/* → dsxpod.server 的 FastAPI app（靜態檔由 Vercel CDN 伺服）。"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dsxpod.server import app  # noqa: E402
