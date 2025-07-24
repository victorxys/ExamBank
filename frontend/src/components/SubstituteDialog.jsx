import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
  TextField, Grid, Autocomplete, CircularProgress, Select, MenuItem, InputLabel, FormControl
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import api from '../api/axios';

const SubstituteDialog = ({ open, onClose, onSave, contractId, contractType }) => {
  const [substituteUser, setSubstituteUser] = useState(null);
  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);
  const [employeeLevel, setEmployeeLevel] = useState('');
  const [managementFeeRate, setManagementFeeRate] = useState(0.25);
  const [userOptions, setUserOptions] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (contractType === 'maternity_nurse') {
      setManagementFeeRate(0.25);
    } else {
      setManagementFeeRate(0.1);
    }
  }, [contractType]);

  const handleUserSearch = async (event, value, reason) => {
    if (reason === 'reset') {
        return; // Do not search when an option is selected
    }
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
      const d = new Date(date);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    const substituteData = {
      main_contract_id: contractId,
      substitute_user_id: substituteUser?.id,
      start_date: formatDate(startDate),
      end_date: formatDate(endDate),
      employee_level: employeeLevel,
    };

    if (contractType === 'maternity_nurse') {
      substituteData.management_fee_rate = managementFeeRate;
    }

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
              getOptionLabel={(option) => `${option.name} (${option.name_pinyin})`}
              filterOptions={(x) => x} // Disable frontend filtering
              onInputChange={handleUserSearch}
              onChange={(event, newValue) => {
                setSubstituteUser(newValue);
              }}
              loading={loading}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="替班人员"
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
          <Grid item xs={6}>
            <DatePicker
              label="开始日期"
              value={startDate}
              onChange={setStartDate}
            />
          </Grid>
          <Grid item xs={6}>
            <DatePicker
              label="结束日期"
              value={endDate}
              onChange={setEndDate}
            />
          </Grid>
          <Grid item xs={6}>
            <TextField
              label="替班员工级别"
              fullWidth
              type="number"
              value={employeeLevel}
              onChange={(e) => setEmployeeLevel(e.target.value)}
            />
          </Grid>
          {contractType === 'maternity_nurse' && (
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
