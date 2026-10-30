from fastapi import APIRouter, HTTPException

from .. import store

router = APIRouter()


@router.get("/merchants/{id}")
def get_merchant(id: str) -> dict:
    if id not in store.merchants:
        raise HTTPException(404, "merchant not found")
    return store.merchants[id]
