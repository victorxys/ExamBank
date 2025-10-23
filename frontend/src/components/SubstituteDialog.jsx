import React, { useState, useEffect, useCallback } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
  TextField, Grid, Autocomplete, CircularProgress, Select, MenuItem, InputLabel, FormControl, Typography, FormHelperText
} from '@mui/material';
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker';
import api from '../api/axios';

const SubstituteDialog = ({ open, onClose, onSave, contractId, billMonth, contractType, originalBillCycleStart,
     originalBillCycleEnd }) => {
  const [substituteUser, setSubstituteUser] = useState(null);
  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);
  const [employeeLevel, setEmployeeLevel] = useState('');
  const [substituteType, setSubstituteType] = useState('maternity_nurse');
  const [managementFeeRate, setManagementFeeRate] = useState('25');
  const [isRateDisabled, setIsRateDisabled] = useState(false);
  const [rateHelperText, setRateHelperText] = useState('');
  const [userOptions, setUserOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [contractContext, setContractContext] = useState(null);
  const [isLoadingContext, setIsLoadingContext] = useState(false);

  useEffect(() => {
    if (open && contractId) {
      setIsLoadingContext(true);
      api.get(`/contracts/${contractId}/substitute-context`)
        .then(response => {
          setContractContext(response.data);
        })
        .catch(error => {
          console.error("获取合同上下文失败:", error);
          setContractContext(null); // 出错时重置
        })
        .finally(() => {
          setIsLoadingContext(false);
        });
    }
  }, [open, contractId]);

  useEffect(() => {
    if (!open) return;

    // 重置基础状态
    setSubstituteUser(null);
    setEmployeeLevel('');
    setUserOptions([]);
    setSubstituteType(contractType || 'maternity_nurse');

    // 设置默认时间
    const start = originalBillCycleStart ? new Date(originalBillCycleStart) : new Date();
    start.setHours(8, 0, 0, 0); // 设置默认开始时间为 08:00

    const end = new Date(start);
    end.setDate(start.getDate() + 1);
    end.setHours(8, 0, 0, 0); // 设置默认结束时间为 08:00

    setStartDate(start);
    setEndDate(end);

  }, [open, contractType, originalBillCycleStart]);

  useEffect(() => {
    if (substituteType === 'maternity_nurse') {
      setManagementFeeRate('25');
      setIsRateDisabled(false);
      setRateHelperText('月嫂替班管理费率通常为25%。');
    } else if (substituteType === 'nanny') {
      if (isLoadingContext) {
        setRateHelperText('正在获取合同信息...');
        setIsRateDisabled(true);
      } else if (contractContext) {
        const { contract_type, effective_end_date } = contractContext;
        if (contract_type === 'auto_renewing') {
          setManagementFeeRate('0');
          setIsRateDisabled(true);
          setRateHelperText('自动续签合同的替班，不收取管理费。');
        } else { // non_auto_renewing
          if (effective_end_date && startDate && new Date(startDate) > new Date(effective_end_date)) {
            setManagementFeeRate('10'); // 合同期外，默认10%
            setIsRateDisabled(false);
            setRateHelperText('替班发生在合同期外，请输入管理费率。');
          } else {
            setManagementFeeRate('0');
            setIsRateDisabled(true);
            setRateHelperText('合同期内的替班，不收取管理费。');
          }
        }
      } else {
        // Fallback if context fails to load
        setManagementFeeRate('0');
        setIsRateDisabled(true);
        setRateHelperText('无法加载合同信息，费率默认为0。');
      }
    }
  }, [substituteType, startDate, contractContext, isLoadingContext]);


  const handleUserSearch = async (event, value) => {
    if (!value) {
      setUserOptions([]);
      return;
    }
    setLoading(true);
    try {
      const response = await api.get(`/users/search?q=${value}`);
      setUserOptions(response.data);
    } catch (error) {
      console.error("搜索用户失败:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = () => {
    if (!substituteUser || !employeeLevel || !startDate || !endDate) {
      alert('请填写所有必填项！');
      return;
    }

    if (endDate <= startDate) {
        alert('结束时间必须晚于开始时间！');
        return;
    }

    const rate = parseFloat(managementFeeRate);
    if (isNaN(rate)) {
        alert('请输入有效的管理费率数字！');
        return;
    }

    const substituteData = {
      main_contract_id: contractId,
      substitute_user_id: substituteUser?.id,
      start_date: startDate?.toISOString(),
      end_date: endDate?.toISOString(),
      employee_level: employeeLevel,
      substitute_type: substituteType,
      substitute_management_fee_rate: rate / 100,
    };

    onSave(substituteData);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>添加替班记录</DialogTitle>
      <DialogContent>
        <Grid container spacing={2} sx={{ pt: 2 }}>
          <Grid item xs={12}>
            <Autocomplete
              options={userOptions}
              getOptionLabel={(option) => `${option.name} (${option.name_pinyin || ''})`}
              filterOptions={(x) => x}
              onInputChange={(event, newInputValue) => handleUserSearch(event, newInputValue)}
              onChange={(event, newValue) => setSubstituteUser(newValue)}
              loading={loading}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="查找替班人员"
                  InputProps={{
                    ...params.InputProps,
                    endAdornment: (
                      <>
                        {loading ? <CircularProgress color="inherit" size={20} /> : null}
                        {params.InputProps.endAdornment}
                      </>
                    ),
                  }}
                />
              )}
            />
          </Grid>
          {(originalBillCycleStart && originalBillCycleEnd) && (
            <Grid item xs={12}>
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                当前账单周期: {new Date(originalBillCycleStart).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })} ~ {new Date(originalBillCycleEnd).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}。
              </Typography>
            </Grid>
          )}
          <Grid item xs={6}>
            <DateTimePicker
              label="开始时间"
              value={startDate}
              onChange={setStartDate}
              ampm={false}
              timeSteps={{ minutes: 30 }}
            />
          </Grid>
          <Grid item xs={6}>
            <DateTimePicker
              label="结束时间"
              value={endDate}
              onChange={setEndDate}
              ampm={false}
              timeSteps={{ minutes: 30 }}
              minDateTime={startDate}
            />
          </Grid>
          
          <Grid item xs={12}>
            <FormControl fullWidth>
              <InputLabel>替班类型</InputLabel>
              <Select
                value={substituteType}
                label="替班类型"
                onChange={(e) => setSubstituteType(e.target.value)}
              >
                <MenuItem value="maternity_nurse">月嫂</MenuItem>
                <MenuItem value="nanny">育儿嫂</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={6}>
            <TextField
              label="替班员工级别/月薪"
              fullWidth
              type="number"
              value={employeeLevel}
              onChange={(e) => setEmployeeLevel(e.target.value)}
            />
          </Grid>
          <Grid item xs={6}>
            <FormControl fullWidth>
                <TextField
                    label="管理费率 (%)"
                    fullWidth
                    type="number"
                    value={managementFeeRate}
                    onChange={(e) => setManagementFeeRate(e.target.value)}
                    disabled={isRateDisabled || isLoadingContext}
                    InputProps={{
                        endAdornment: <Typography>%</Typography>,
                    }}
                />
                <FormHelperText>{rateHelperText}</FormHelperText>
            </FormControl>
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>取消</Button>
        <Button onClick={handleSave} variant="contained">保存</Button>
      </DialogActions>
    </Dialog>
  );
};

export default SubstituteDialog;
