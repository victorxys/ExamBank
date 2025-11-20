# Contract Data Optimization Design Checklist

## 1. Database Schema Verification
- [ ] **Check `BaseContract` Model**: Verify `template_content` field is removed.
- [ ] **Check `ContractSignature` Model**: Verify model exists with fields: `contract_id`, `file_path`, `signature_type` (customer/employee), `created_at`.
- [ ] **Migration Check**: Verify Alembic migration script exists for schema changes.

## 2. Backend Logic Verification
- [ ] **Contract Creation**: Verify `ContractService.create_contract` (or equivalent) fetches template content from `ContractTemplate` if needed for initial logic (though it shouldn't store it).
- [ ] **Contract Retrieval**: Verify `ContractService.get_contract` returns `template_content` by accessing `contract.template.content`.
- [ ] **Signature Saving**: Verify `ContractService.sign_contract` saves image to disk and creates `ContractSignature` record.
- [ ] **Signature Retrieval**: Verify `contract.to_dict()` includes URLs for signatures (derived from `ContractSignature` records).

## 3. Frontend Compatibility Verification
- [ ] **API Response Structure**: Verify the JSON response for contract details matches what the frontend expects (i.e., `template_content` key exists, `customer_signature` key exists with URL).
- [ ] **Signature Display**: Verify frontend `<img>` tags point to the correct new URLs.

## 4. Performance & Security
- [ ] **Lazy Loading**: Ensure `template.content` is not loaded unless necessary (though usually it is for detail view).
- [ ] **File Access**: Ensure signature files are accessible via a secure or public URL as per requirements (assuming public for now for simplicity, or protected via API).

## 5. Data Integrity
- [ ] **Migration Safety**: Ensure existing contracts (if any) can still be viewed. (Note: User said "partially done", assuming new architecture moving forward).
