"""
Board Compositor - PDF Imposition / Layout Module

Allows composing multiple PDFs onto a single "board" page before sending to the RIP.
Similar to commercial RIP workflow where you create a board/page layout with multiple PDFs.

Usage:
    from board_compositor import BoardCompositor, PDFPlacement

    compositor = BoardCompositor(board_width_inches=24, board_height_inches=36)
    compositor.add_pdf(
        pdf_path="/path/to/file.pdf",
        x_inches=0,
        y_inches=0,
        scale=1.0,
        rotation_degrees=0,
        page_number=0  # 0 = all pages, or specific page
    )
    compositor.add_pdf(...)
    output_path = compositor.composite()
"""

from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import fitz  # PyMuPDF

# 72 points per inch (PDF standard)
POINTS_PER_INCH = 72


@dataclass
class PDFPlacement:
    """Represents a PDF placed on the board."""
    pdf_path: str
    x_inches: float = 0.0          # X position from top-left
    y_inches: float = 0.0          # Y position from top-left
    scale: float = 1.0             # Scale factor (1.0 = 100%)
    rotation_degrees: float = 0.0  # Rotation clockwise
    page_number: int = 0            # 0 = all pages, or specific page


@dataclass
class BoardConfig:
    """Configuration for the composition board."""
    width_inches: float
    height_inches: float
    background_color: tuple = (1, 1, 1)  # White in RGB 0-1

    @property
    def width_points(self) -> float:
        return self.width_inches * POINTS_PER_INCH

    @property
    def height_points(self) -> float:
        return self.height_inches * POINTS_PER_INCH


class BoardCompositor:
    """
    Composites multiple PDFs onto a single board page.

    Supports:
    - Multiple PDFs per board
    - Positioning via x/y coordinates in inches
    - Scaling
    - Rotation
    - Per-PDF page selection
    """

    def __init__(
        self,
        board_width_inches: float,
        board_height_inches: float,
        background_color: tuple = (1, 1, 1)
    ):
        self.board = BoardConfig(
            width_inches=board_width_inches,
            height_inches=board_height_inches,
            background_color=background_color
        )
        self.placements: list[PDFPlacement] = []

    def add_pdf(
        self,
        pdf_path: str,
        x_inches: float = 0.0,
        y_inches: float = 0.0,
        scale: float = 1.0,
        rotation_degrees: float = 0.0,
        page_number: int = 0
    ) -> "BoardCompositor":
        """
        Add a PDF to the board.

        Args:
            pdf_path: Path to the PDF file
            x_inches: X position from top-left of board (inches)
            y_inches: Y position from top-left of board (inches)
            scale: Scale factor (1.0 = 100%, 0.5 = 50%)
            rotation_degrees: Clockwise rotation in degrees
            page_number: Which page to use (0 = all pages as separate placements)

        Returns:
            self for chaining
        """
        if not Path(pdf_path).exists():
            raise FileNotFoundError(f"PDF not found: {pdf_path}")

        self.placements.append(PDFPlacement(
            pdf_path=pdf_path,
            x_inches=x_inches,
            y_inches=y_inches,
            scale=scale,
            rotation_degrees=rotation_degrees,
            page_number=page_number
        ))
        return self

    def composite(self, output_path: Optional[str] = None) -> str:
        """
        Composite all PDFs onto the board and save as a new PDF.

        Args:
            output_path: Optional output path. If None, creates a temp file.

        Returns:
            Path to the composite PDF
        """
        if not self.placements:
            raise ValueError("No PDFs have been added to the board")

        # Create output path
        if output_path is None:
            fd, output_path = tempfile.mkstemp(suffix=".pdf", prefix="board_composite_")
            os.close(fd)

        # Create the output PDF
        output_doc = fitz.open()
        output_page = output_doc.new_page(
            width=self.board.width_points,
            height=self.board.height_points
        )

        # Fill background
        if self.board.background_color != (1, 1, 1):
            bg_rect = fitz.Rect(0, 0, self.board.width_points, self.board.height_points)
            output_page.draw_rect(bg_rect, color=self.board.background_color, fill=self.board.background_color)

        for placement in self.placements:
            self._place_pdf_on_page(output_page, placement)

        output_doc.save(output_path)
        output_doc.close()

        return output_path

    def _place_pdf_on_page(self, output_page: fitz.Page, placement: PDFPlacement) -> None:
        """Place a single PDF onto the output page."""
        src_doc = fitz.open(placement.pdf_path)

        # Determine which pages to place
        if placement.page_number == 0:
            # All pages - we'll place each page from the source
            for page_idx in range(len(src_doc)):
                self._place_single_page(
                    output_page, src_doc, page_idx, placement
                )
        else:
            # Specific page (1-indexed in PDF, but we use 0-indexed)
            page_idx = placement.page_number - 1
            if 0 <= page_idx < len(src_doc):
                self._place_single_page(output_page, src_doc, page_idx, placement)

        src_doc.close()

    def _place_single_page(
        self,
        output_page: fitz.Page,
        src_doc: fitz.Document,
        page_idx: int,
        placement: PDFPlacement
    ) -> None:
        """Place a single page from src_doc onto the output page."""
        src_page = src_doc[page_idx]

        # Calculate position in points
        x_points = placement.x_inches * POINTS_PER_INCH
        y_points = placement.y_inches * POINTS_PER_INCH

        # Get source page dimensions
        src_width = src_page.rect.width
        src_height = src_page.rect.height

        # Apply scale
        if placement.scale != 1.0:
            new_width = src_width * placement.scale
            new_height = src_height * placement.scale
        else:
            new_width = src_width
            new_height = src_height

        # Create destination rectangle
        dest_rect = fitz.Rect(
            x_points,
            y_points,
            x_points + new_width,
            y_points + new_height
        )

        # Create transformation matrix
        mat = fitz.Matrix()

        # Apply scale
        if placement.scale != 1.0:
            mat = fitz.Matrix(placement.scale, placement.scale)

        # Apply rotation if needed
        if placement.rotation_degrees != 0:
            # Use PyMuPDF's built-in rotation
            rot_mat = fitz.Matrix(
                fitz.cos(placement.rotation_degrees * (3.14159265 / 180)),
                fitz.sin(placement.rotation_degrees * (3.14159265 / 180)),
                -fitz.sin(placement.rotation_degrees * (3.14159265 / 180)),
                fitz.cos(placement.rotation_degrees * (3.14159265 / 180))
            )
            mat = mat * rot_mat

        # Show the page with transformation
        output_page.show_pdf_page(
            dest_rect,
            src_doc,
            page_idx,
            clip=None,
            overlay=True,
            mat=mat
        )


def composite_board_job(
    board_width_inches: float,
    board_height_inches: float,
    placements: list[dict],
    output_path: Optional[str] = None
) -> str:
    """
    Convenience function to composite a board job from a list of placement dicts.

    Args:
        board_width_inches: Width of the board in inches
        board_height_inches: Height of the board in inches
        placements: List of dicts with keys: pdf_path, x_inches, y_inches, scale, rotation_degrees, page_number
        output_path: Optional output path

    Returns:
        Path to the composite PDF

    Example placement dict:
        {
            "pdf_path": "/path/to/file.pdf",
            "x_inches": 0,
            "y_inches": 0,
            "scale": 1.0,
            "rotation_degrees": 0,
            "page_number": 0
        }
    """
    compositor = BoardCompositor(
        board_width_inches=board_width_inches,
        board_height_inches=board_height_inches
    )

    for p in placements:
        compositor.add_pdf(
            pdf_path=p["pdf_path"],
            x_inches=p.get("x_inches", 0.0),
            y_inches=p.get("y_inches", 0.0),
            scale=p.get("scale", 1.0),
            rotation_degrees=p.get("rotation_degrees", 0.0),
            page_number=p.get("page_number", 0)
        )

    return compositor.composite(output_path)
