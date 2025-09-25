import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
  TextField, Grid, Autocomplete, CircularProgress, Select, MenuItem, InputLabel, FormControl, Typography
} from '@mui/material';
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker';
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

      if (contractType) {
        setSubstituteType(contractType);
        if (contractType === 'nanny') {
          setManagementFeeRate('0'); // 2. 育儿嫂替班时设为0
        } else {
          setManagementFeeRate('25'); // 3. 月嫂替班时默认25
        }
      } else {
        setSubstituteType('maternity_nurse');
        setManagementFeeRate('25'); // 4. 默认情况也是25
      }

      if (originalBillCycleStart) {
        setStartDate(new Date(originalBillCycleStart));
        const nextDay = new Date(originalBillCycleStart);
        nextDay.setDate(nextDay.getDate() + 1);
        setEndDate(nextDay);
      } else {
        setStartDate(null);
        setEndDate(null);
      }
    }
  }, [open, billMonth, contractType, originalBillCycleStart]);

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
     // 1. 必填项校验
    if (!substituteUser) {
      alert('请选择替班人员！');
      return; // 阻止保存
    }
    if (!employeeLevel || String(employeeLevel).trim() === '') {
      alert('请输入替班员工的级别/月薪！');
      return; // 阻止保存
    }
    const substituteData = {
      main_contract_id: contractId,
      substitute_user_id: substituteUser?.id,
      start_date: startDate?.toISOString(),
      end_date: endDate?.toISOString(),
      employee_level: employeeLevel,
      substitute_type: substituteType,
      management_fee_rate: substituteType === 'maternity_nurse' ? (parseFloat(managementFeeRate) / 100) : 0
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
                只能在当前账单周期 {new Date(originalBillCycleStart).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })} ~ {new Date(originalBillCycleEnd).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })} 内添加替班。
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
              minDateTime={originalBillCycleStart ? new Date(originalBillCycleStart) : null}
              // maxDateTime={originalBillCycleEnd ? new Date(originalBillCycleEnd) : null}
            />
          </Grid>
          <Grid item xs={6}>
            <DateTimePicker
              label="结束时间"
              value={endDate}
              onChange={setEndDate}
              ampm={false}
              timeSteps={{ minutes: 30 }}
              minDateTime={startDate || (originalBillCycleStart ? new Date(originalBillCycleStart) : null)}
              // maxDateTime={originalBillCycleEnd ? new Date(originalBillCycleEnd) : null}
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
                    setManagementFeeRate(25);
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
              <TextField
                label="管理费率 (%)"
                fullWidth
                type="number"
                value={managementFeeRate}
                onChange={(e) => setManagementFeeRate(e.target.value)}
                InputProps={{
                  endAdornment: <Typography>%</Typography>,
                }}
              />
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
