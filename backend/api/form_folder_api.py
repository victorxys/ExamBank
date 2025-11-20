from flask import Blueprint, request, jsonify
from backend.models import db, FormFolder
from psycopg2.extras import RealDictCursor
from backend.db import get_db_connection

form_folder_bp = Blueprint("form_folder_api", __name__)

@form_folder_bp.route("/api/form-folders", methods=["GET"])
def get_folders():
    try:
        folders = FormFolder.query.order_by(FormFolder.created_at.desc()).all()
        return jsonify([{
            "id": folder.id,
            "name": folder.name,
            "description": folder.description,
            "parent_id": folder.parent_id,
            "created_at": folder.created_at,
            "updated_at": folder.updated_at
        } for folder in folders])
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@form_folder_bp.route("/api/form-folders", methods=["POST"])
def create_folder():
    data = request.get_json()
    if not data or "name" not in data:
        return jsonify({"error": "Missing required fields"}), 400

    try:
        new_folder = FormFolder(
            name=data["name"],
            description=data.get("description", ""),
            parent_id=data.get("parent_id")
        )
        db.session.add(new_folder)
        db.session.commit()
        
        return jsonify({
            "id": new_folder.id,
            "name": new_folder.name,
            "description": new_folder.description,
            "parent_id": new_folder.parent_id,
            "created_at": new_folder.created_at,
            "updated_at": new_folder.updated_at
        }), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500

@form_folder_bp.route("/api/form-folders/<uuid:folder_id>", methods=["PUT"])
def update_folder(folder_id):
    data = request.get_json()
    try:
        folder = FormFolder.query.get(folder_id)
        if not folder:
            return jsonify({"error": "Folder not found"}), 404

        if "name" in data:
            folder.name = data["name"]
        if "description" in data:
            folder.description = data["description"]
        if "parent_id" in data:
            folder.parent_id = data["parent_id"]
        
        db.session.commit()
        
        return jsonify({
            "id": folder.id,
            "name": folder.name,
            "description": folder.description,
            "parent_id": folder.parent_id,
            "created_at": folder.created_at,
            "updated_at": folder.updated_at
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500

@form_folder_bp.route("/api/form-folders/<uuid:folder_id>", methods=["DELETE"])
def delete_folder(folder_id):
    try:
        folder = FormFolder.query.get(folder_id)
        if not folder:
            return jsonify({"error": "Folder not found"}), 404

        # Check if folder has forms? 
        # The model has `ondelete="SET NULL"` for forms, so we can safely delete.
        # But maybe we want to warn user? For now, just delete.
        
        db.session.delete(folder)
        db.session.commit()
        
        return jsonify({"message": "Folder deleted successfully"})
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500
