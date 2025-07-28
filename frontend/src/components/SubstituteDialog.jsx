import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
  TextField, Grid, Autocomplete, CircularProgress, Select, MenuItem, InputLabel, FormControl, Typography
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import api from '../api/axios';

const SubstituteDialog = ({ open, onClose, onSave, contractId, billMonth, contractType, originalBillCycleStart,
     originalBillCycleEnd }) => {
  const [substituteUser, setSubstituteUser] = useState(null);
  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);
  const [employeeLevel, setEmployeeLevel] = useState('');
  const [substituteType, setSubstituteType] = useState('maternity_nurse'); // 'maternity_nurse' or 'nanny'
  const [managementFeeRate, setManagementFeeRate] = useState(0.25);
  const [userOptions, setUserOptions] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setSubstituteUser(null);
      setEmployeeLevel('');
      setUserOptions([]);

      // console.log('SubstituteDialog useEffect triggered. Received contractType:', contractType); // <-- 添加这里


      // Set default substituteType based on contractType
      if (contractType) {
        setSubstituteType(contractType);
        // console.log('Setting substituteType to:', contractType); 
        // Also set managementFeeRate based on the default substituteType
        if (contractType === 'nanny') {
          setManagementFeeRate(0);
        } else {
          setManagementFeeRate(0.25); // Default for maternity nurse
        }
      } else {
        setSubstituteType('maternity_nurse'); // Fallback default
        setManagementFeeRate(0.25);
        // console.log('contractType is falsy, defaulting substituteType to maternity_nurse'); // <-- 添加这里
      }

      // Set default dates based on billMonth
      if (billMonth) {
        const [year, month] = billMonth.split('-').map(Number);
        const firstDayOfMonth = new Date(year, month - 1, 1);
        setStartDate(firstDayOfMonth);
        // Set endDate to the second day of the month by default
        const secondDayOfMonth = new Date(year, month - 1, 2);
        setEndDate(secondDayOfMonth);
      } else {
        // If no billMonth, clear dates
        setStartDate(null);
        setEndDate(null);
      }
    }
  }, [open, billMonth, contractType]);

  // Update endDate when startDate changes
  useEffect(() => {
    if (startDate) {
      const nextDay = new Date(startDate);
      nextDay.setDate(startDate.getDate() + 1);
      setEndDate(nextDay);
    }
  }, [startDate]);

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
    const formatDate = (date) => {
      if (!date) return null;
      // The `date` from MUI's DatePicker is a Date object in the local timezone.
      // We need to format it to a YYYY-MM-DD string without any timezone conversion.
      const d = new Date(date);
      const year = d.getFullYear();
      const month = (d.getMonth() + 1).toString().padStart(2, '0');
      const day = d.getDate().toString().padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    const substituteData = {
      main_contract_id: contractId,
      substitute_user_id: substituteUser?.id,
      start_date: formatDate(startDate),
      end_date: formatDate(endDate),
      employee_level: employeeLevel,
      substitute_type: substituteType,
      management_fee_rate: substituteType === 'maternity_nurse' ? managementFeeRate : 0,
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
          {/* 新增的提示信息 */}
          {(originalBillCycleStart && originalBillCycleEnd) && (
            <Grid item xs={12}>
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                只能在当前账单周期 {new Date(originalBillCycleStart).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit'})} ~ {new Date(originalBillCycleEnd).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })} 内添加替班。
              </Typography>
            </Grid>
          )}
          <Grid item xs={6}>
            <DatePicker
              label="开始日期"
              value={startDate}
              onChange={setStartDate}
              minDate={originalBillCycleStart ? new Date(originalBillCycleStart) : null}
              maxDate={originalBillCycleEnd ? new Date(originalBillCycleEnd) : null}
            />
          </Grid>
          <Grid item xs={6}>
            <DatePicker
              label="结束日期"
              value={endDate}
              onChange={setEndDate}
              minDate={originalBillCycleStart ? new Date(originalBillCycleStart) : null}
              maxDate={originalBillCycleEnd ? new Date(originalBillCycleEnd) : null}
            />
          </Grid>
          
          <Grid item xs={12}>
            <FormControl fullWidth>
              <InputLabel>替班类型</InputLabel>
              <Select
                value={substituteType}
                label="替班类型"
                onChange={(e) => {
                  setSubstituteType(e.target.value);
                  if (e.target.value === 'nanny') {
                    setManagementFeeRate(0);
                  } else {
                    setManagementFeeRate(0.25); // Default for maternity nurse
                  }
                }}
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
          {substituteType === 'maternity_nurse' && (
            <Grid item xs={6}>
              <FormControl fullWidth>
                <InputLabel>管理费率</InputLabel>
                <Select
                  value={managementFeeRate}
                  label="管理费率"
                  onChange={(e) => setManagementFeeRate(parseFloat(e.target.value))}
                >
                  <MenuItem value={0.25}>25%</MenuItem>
                  <MenuItem value={0.15}>15%</MenuItem>
                </Select>
              </FormControl>
            </Grid>
          )}
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
