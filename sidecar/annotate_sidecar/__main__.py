"""
Entry point: python -m annotate_sidecar [--port PORT] [--log-level LEVEL]
"""

import argparse
import logging
import sys


def main():
    parser = argparse.ArgumentParser(
        prog="annotate_sidecar",
        description="ML sidecar for the annotate tool",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8321,
        help="Port to listen on (default: 8321)",
    )
    parser.add_argument(
        "--host",
        type=str,
        default="127.0.0.1",
        help="Host to bind to (default: 127.0.0.1)",
    )
    parser.add_argument(
        "--log-level",
        type=str,
        default="info",
        choices=["debug", "info", "warning", "error"],
        help="Log level (default: info)",
    )
    parser.add_argument(
        "--project-root",
        type=str,
        default=None,
        help="Absolute path to the project folder. Relative video paths will be resolved against this.",
    )
    args = parser.parse_args()

    # Configure logging
    logging.basicConfig(
        level=getattr(logging, args.log_level.upper()),
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )

    try:
        import uvicorn
    except ImportError:
        print("Error: uvicorn is required. Install with: pip install uvicorn", file=sys.stderr)
        sys.exit(1)

    from .server import create_app

    app = create_app(project_root=args.project_root)

    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        log_level=args.log_level,
    )


if __name__ == "__main__":
    main()
