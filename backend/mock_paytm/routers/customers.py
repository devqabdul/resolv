from fastapi import APIRouter, HTTPException

from .. import store

router = APIRouter()


@router.get("/customers/{id}")
def get_customer(id: str) -> dict:
    if id not in store.customers:
        raise HTTPException(404, "customer not found")
    return store.customers[id]
