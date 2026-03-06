from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.endpoints import employees
from app.core.config import settings

app = FastAPI(
    title="Employee Management API",
    openapi_url=f"{settings.API_V1_STR}/openapi.json"
)

# Set all CORS enabled origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(employees.router, prefix=settings.API_V1_STR, tags=["employees"])

@app.get("/")
def root():
    return {"message": "Employee Management Microservice is running"}
