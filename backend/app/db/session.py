from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import sessionmaker

from app.config import settings

_args = {"check_same_thread": False} if settings.DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(settings.DATABASE_URL, connect_args=_args)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def init_db(bind: Engine | None = None) -> None:
    from app.db.models import Base

    Base.metadata.create_all(bind or engine)


def reset_db(bind: Engine | None = None) -> None:
    from app.db.models import Base

    Base.metadata.drop_all(bind or engine)
    Base.metadata.create_all(bind or engine)
