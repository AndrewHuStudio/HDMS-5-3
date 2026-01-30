# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

HDMS (High-Density Mixed-use District Management System) is an urban design control and validation platform. It enables web-based one-click detection of 3D models (.3dm) against urban design requirements using Grasshopper logic via Rhino.Compute.

## Architecture

Three-tier stack:
```
Frontend (Next.js 16 + React 19 + Three.js)  →  port 3000
    ↓
Backend API (FastAPI + Python)               →  port 8000
    ↓
Computation Engine (Rhino.Compute)           →  port 6500
```

Key directories:
- `apps/frontend/` - Main frontend (Next.js + Three.js 3D visualization)
- `services/rhino-api/` - Backend API for .3dm parsing and Grasshopper execution
- `services/rhino-api/gh/` - Grasshopper definition files (.ghx)
- `third_party/compute.rhino3d/` - Rhino.Compute source (C#/.NET)
- `my-app/` - Legacy frontend reference (do not modify)
- `data/uploads/` - Uploaded .3dm files
- `data/cache/` - Processed model cache

## Common Commands

### Frontend
```bash
npm install --prefix apps/frontend
npm run dev --prefix apps/frontend
npm run build --prefix apps/frontend
npm run lint --prefix apps/frontend
```

### Backend
```bash
# Setup (PowerShell)
python -m venv services\rhino-api\.venv
.\services\rhino-api\.venv\Scripts\activate
pip install -r services\rhino-api\requirements.txt

# Run
python -m uvicorn rhino_api.main:app --reload --port 8000 --app-dir services/rhino-api
```

### Rhino.Compute
```bash
dotnet run --project third_party/compute.rhino3d/src/rhino.compute/rhino.compute.csproj
```

## Backend API Endpoints

- `POST /models/import` - Upload and parse .3dm file
- `POST /height-check` - Validate building height (mesh ID selection)
- `POST /validate/height` - Validate with limit layers
- `POST /validate/height/by-building` - Validate with max_height parameter
- `GET /health` - Health check

## Grasshopper Integration

GH definitions must follow strict naming conventions for Rhino.Compute:

**Inputs (RH_IN):**
- Group name: `RH_IN <param_name>` (e.g., `RH_IN building_brep`)
- Parameter NickName must match `<param_name>` exactly
- Clear all PersistentData before saving
- Use Brep type (not generic Geometry)

**Outputs (RH_OUT):**
- Group name: `RH_OUT <param_name>` (e.g., `RH_OUT building_over_limit`)
- Boolean output: True = violation, False = compliant

After modifying .ghx files, restart Rhino.Compute to clear cache.

## Environment Variables

Backend uses these (see `services/rhino-api/.env.example`):
- `RHINO_COMPUTE_URL` - Default: http://localhost:6500
- `MODEL_STORAGE_PATH` - Default: ../../data/uploads
- `GH_DEFINITIONS_PATH` - Default: ./gh
- `MAX_UPLOAD_MB` - Default: 500
- `CORS_ORIGINS` - Default: http://localhost:3000

## Key Implementation Notes

- Frontend renders 3D models as white with edge lines using Three.js
- Backend converts Mesh/Extrusion to Brep before sending to Grasshopper
- Height validation uses building Brep bounding box min Z as baseline
- File uploads limited to 500MB
- Geometry selection in frontend uses mesh IDs to identify objects

## Code Conventions

- Frontend uses Shadcn UI components with Radix primitives
- Backend uses Pydantic models for request/response validation
- GH runner encodes geometry using `rhino3dm.CommonObject.Encode()`
- API responses include `highlight_boxes` (min/max coordinates) for frontend visualization
