"""dpcleaner — near-duplicate image finder for illustrations (Pixiv/Twitter).

Clean Architecture layers (dependencies point inward):
    domain     -> entities + clustering policy (pure)
    interfaces -> ports (Protocol) for the I/O boundaries
    usecases   -> scan/embed/cache/group + trash/undo, rename orchestration
    adapters   -> SSCD model, SQLite, filesystem, recycle bin, settings JSON
    web        -> FastAPI routes, presenters, composition root

Pipeline the use-cases drive: scan -> embed(+cache) -> cluster (flip-aware
cosine + union-find) -> send unwanted copies to the OS recycle bin.
"""

__version__ = "0.2.0"
