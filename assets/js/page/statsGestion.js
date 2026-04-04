window.addEventListener('DOMContentLoaded', () => {
    const natureCheckbox = document.getElementById('nature')
    const ugeCheckbox = document.getElementById('uge')

    natureCheckbox.checked = true
    ugeCheckbox.checked = true

    const natureChange = () => {
        const boxList = document.querySelectorAll('input[name="gestion[natur][]"]')
        boxList.forEach(el => {
            el.checked = natureCheckbox.checked === true;
        })
    }

    const ugeChange = () => {
        const boxList = document.querySelectorAll('input[name="gestion[uge][]"]')
        boxList.forEach(el => {
            el.checked = ugeCheckbox.checked === true;
        })
    }

    natureCheckbox.addEventListener('change', natureChange)
    ugeCheckbox.addEventListener('change', ugeChange)

    natureChange()
    ugeChange()
})