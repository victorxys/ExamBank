import { useState, useEffect, useCallback } from 'react';
import {
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Box,
  Card,
  CardHeader,
  CardContent,
  useMediaQuery,
  TablePagination,
  CircularProgress,
  TextField,
  Select,
  MenuItem,
  Typography
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import PageHeader from './PageHeader';
import AlertMessage from './AlertMessage';
import { formatRelativeTime } from '../api/dateUtils';

const StaffManagementPage = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(false);
  const [alertMessage, setAlertMessage] = useState(null);
  const [alertOpen, setAlertOpen] = useState(false);

  // State for searching, filtering, and pagination
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('active');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [total, setTotal] = useState(0);
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState('desc');

  const fetchEmployees = useCallback(async () => {
    setLoading(true);
    try {
      const params = {
        page: page + 1,
        per_page: rowsPerPage,
        sort_by: sortBy,
        sort_order: sortOrder,
        search: searchTerm,
        status: filterStatus,
      };
      const response = await api.staff.getEmployees(params);
      setEmployees(response.data.items);
      setTotal(response.data.total);
    } catch (error) {
      setAlertMessage({ severity: 'error', message: '获取员工列表失败' });
      setAlertOpen(true);
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, [page, rowsPerPage, searchTerm, sortBy, sortOrder, filterStatus]);

  useEffect(() => {
    const handler = setTimeout(() => {
      fetchEmployees();
    }, 500); // Debounce search term
    return () => clearTimeout(handler);
  }, [fetchEmployees, searchTerm]);

  useEffect(() => {
    setPage(0);
  }, [searchTerm, filterStatus]);

  const handleSort = (column) => {
    const isAsc = sortBy === column && sortOrder === 'asc';
    setSortOrder(isAsc ? 'desc' : 'asc');
    setSortBy(column);
  };

  const handleChangePage = (event, newPage) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  return (
    <Box>
      <AlertMessage
        open={alertOpen}
        message={alertMessage?.message}
        severity={alertMessage?.severity || 'info'}
        onClose={() => setAlertOpen(false)}
      />
      <PageHeader
        title="员工管理"
        description="查看和管理所有服务人员的信息。"
      />

      <Card>
        <CardHeader
          title={
            <Box display="flex" justifyContent="space-between" alignItems="center" gap={2}>
              <Box display="flex" gap={2} flex={1}>
                <TextField
                  size="small"
                  placeholder="搜索姓名或手机号"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  fullWidth
                />
                <Select
                  size="small"
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  sx={{ minWidth: 120 }}
                >
                  <MenuItem value="all">所有状态</MenuItem>
                  <MenuItem value="active">在职</MenuItem>
                  <MenuItem value="inactive">离职</MenuItem>
                </Select>
              </Box>
            </Box>
          }
        />
        <CardContent>
          <TableContainer component={Paper} sx={{ boxShadow: 'none' }}>
            {loading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}><CircularProgress /></Box>
            ) : (
              <>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell onClick={() => handleSort('name')} sx={{ cursor: 'pointer' }}>姓名</TableCell>
                      <TableCell>手机号</TableCell>
                      <TableCell onClick={() => handleSort('is_active')} sx={{ cursor: 'pointer' }}>状态</TableCell>
                      <TableCell onClick={() => handleSort('created_at')} sx={{ cursor: 'pointer' }}>创建时间</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {employees.length > 0 ? (
                      employees.map((employee) => (
                        <TableRow
                          key={employee.id}
                          hover
                          onClick={() => navigate(`/staff/${employee.id}`)}
                          sx={{ cursor: 'pointer' }}
                        >
                          <TableCell>{employee.name}</TableCell>
                          <TableCell>{employee.phone_number}</TableCell>
                          <TableCell>
                            <Typography
                              sx={{
                                backgroundColor: employee.is_active ? theme.palette.success.light : theme.palette.error.light,
                                color: 'white',
                                borderRadius: '12px',
                                padding: '2px 8px',
                                display: 'inline-block',
                                fontSize: '0.75rem'
                              }}
                            >
                              {employee.is_active ? '在职' : '离职'}
                            </Typography>
                          </TableCell>
                          <TableCell>{formatRelativeTime(employee.created_at)}</TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={4} align="center">没有找到员工</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
                <TablePagination
                  component="div"
                  count={total}
                  page={page}
                  onPageChange={handleChangePage}
                  rowsPerPage={rowsPerPage}
                  onRowsPerPageChange={handleChangeRowsPerPage}
                  rowsPerPageOptions={[5, 10, 25]}
                  labelRowsPerPage="每页行数:"
                  labelDisplayedRows={({ from, to, count }) => `${from}-${to} of ${count}`}
                />
              </>
            )}
          </TableContainer>
        </CardContent>
      </Card>
    </Box>
  );
};

export default StaffManagementPage;