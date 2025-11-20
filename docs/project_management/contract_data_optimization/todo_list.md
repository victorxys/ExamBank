# Contract Data Optimization To-Do List

## Phase 1: Remove `template_content` Dependency
- [ ] **Codebase Analysis**
    - [ ] Search for all occurrences of `template_content` in the backend.
    - [ ] Search for all occurrences of `template_content` in the frontend.
- [ ] **Backend Refactoring**
    - [ ] Update `BaseContract` model to ensure `template_content` is removed (if not already).
    - [ ] Modify `contract_api.py` (and other relevant files) to fetch content from `contract.template.content`.
    - [ ] Ensure `contract.to_dict()` or serialization logic includes `template_content` (fetched from relation) if the frontend still expects it, OR update frontend to expect a different structure. *Decision: Keep API response structure compatible if possible, or update frontend.*
- [ ] **Frontend Refactoring**
    - [ ] Verify if frontend needs changes (e.g. if it was accessing `contract.template_content` directly from a list).

## Phase 2: Externalize Signatures (If not already done)
- [ ] **Database Design**
    - [ ] Create `ContractSignature` model.
    - [ ] Create migration to add `contract_signatures` table and remove `customer_signature`/`employee_signature` columns from `contracts`.
- [ ] **File Storage Implementation**
    - [ ] Implement file saving logic for signatures (base64 -> file).
    - [ ] Implement file serving logic (if not using public static folder).
- [ ] **Backend Refactoring**
    - [ ] Update contract creation/signing logic to save signatures as files and create `ContractSignature` records.
    - [ ] Update contract fetching logic to include signature URLs/paths.
- [ ] **Data Migration**
    - [ ] (Optional/If needed) Script to migrate existing base64 signatures to files.

## Phase 3: Verification
- [ ] **Unit Testing**
    - [ ] Test contract creation with template association.
    - [ ] Test contract signing (customer & employee).
    - [ ] Test contract detail retrieval.
- [ ] **Manual Verification**
    - [ ] Verify "Navicat" performance (subjective/user feedback).
    - [ ] Verify UI displays contract content and signatures correctly.
