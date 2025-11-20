
/**
 * Formats an address object into a readable string.
 * @param {Object|string} address - The address object or string.
 * @returns {string} The formatted address string.
 */
export const formatAddress = (address) => {
    if (!address) return '';
    if (typeof address === 'string') return address;

    const parts = [];
    if (address.province) parts.push(address.province);
    if (address.city) parts.push(address.city);
    if (address.district) parts.push(address.district);
    if (address.street) parts.push(address.street);

    return parts.join(' ');
};
