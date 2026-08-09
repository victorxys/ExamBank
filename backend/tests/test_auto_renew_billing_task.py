from unittest.mock import MagicMock, call, patch

from flask import Flask

from backend.tasks import auto_check_and_extend_renewal_bills_task


def _contract(contract_id):
    contract = MagicMock()
    contract.id = contract_id
    return contract


@patch("backend.tasks.get_task_logger")
@patch("backend.tasks.BillingEngine")
@patch("backend.tasks.NannyContract")
@patch("backend.tasks.create_flask_app_for_task")
@patch("backend.tasks.db")
def test_auto_renew_task_commits_each_contract(
    mock_db,
    mock_create_app,
    mock_contract_model,
    mock_engine_class,
    _mock_task_logger,
):
    mock_create_app.return_value = Flask(__name__)
    mock_contract_model.query.filter.return_value.all.return_value = [
        _contract("contract-1"),
        _contract("contract-2"),
    ]

    result = auto_check_and_extend_renewal_bills_task.run()

    mock_engine_class.return_value.extend_auto_renew_bills.assert_has_calls(
        [call("contract-1"), call("contract-2")]
    )
    assert mock_db.session.commit.call_count == 2
    mock_db.session.rollback.assert_not_called()
    assert result == {
        "status": "Success",
        "message": "每周自动续约检查任务完成。成功 2 个，失败 0 个。",
        "processed": 2,
        "failed": 0,
        "failed_contract_ids": [],
    }


@patch("backend.tasks.get_task_logger")
@patch("backend.tasks.BillingEngine")
@patch("backend.tasks.NannyContract")
@patch("backend.tasks.create_flask_app_for_task")
@patch("backend.tasks.db")
def test_auto_renew_task_rolls_back_failure_and_continues(
    mock_db,
    mock_create_app,
    mock_contract_model,
    mock_engine_class,
    mock_task_logger,
):
    mock_create_app.return_value = Flask(__name__)
    mock_contract_model.query.filter.return_value.all.return_value = [
        _contract("contract-1"),
        _contract("contract-2"),
        _contract("contract-3"),
    ]
    mock_engine_class.return_value.extend_auto_renew_bills.side_effect = [
        None,
        RuntimeError("generation failed"),
        None,
    ]

    result = auto_check_and_extend_renewal_bills_task.run()

    mock_engine_class.return_value.extend_auto_renew_bills.assert_has_calls(
        [call("contract-1"), call("contract-2"), call("contract-3")]
    )
    assert mock_db.session.commit.call_count == 2
    mock_db.session.rollback.assert_called_once_with()
    assert result["status"] == "PartialSuccess"
    assert result["processed"] == 2
    assert result["failed"] == 1
    assert result["failed_contract_ids"] == ["contract-2"]
    mock_task_logger.return_value.warning.assert_called_once()
